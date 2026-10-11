# Space Bench Engine — our own circuit simulator

**Status:** Draft v0.1 (design spec for implementation)
**Replaces:** the external simulator used by the Python prototype. Space Bench ships its **own** engine with no third-party simulator inside.
**Companion docs:** [`kirk-language-spec.md`](kirk-language-spec.md) (the language that feeds this engine)

---

## 1. Goals

| Goal | Meaning |
|---|---|
| **Own implementation** | Written by us from the published theory of circuit simulation; no third-party simulator code in the product (see §11, "How we learn from existing simulators"). |
| **Two modes, one engine** | **Accurate** (SPICE-class analyses, adaptive timestep, tight tolerances) and **Real-time** (fixed small step, 60 fps, live sliders, current-flow animation). |
| **Every analysis the UI shows** | OP, transient, AC, DC sweep, noise, FFT/THD (post-processing), parameter sweep, Monte Carlo, temperature. |
| **Fast enough to feel live** | 555 blinker (≈ 20 unknowns): 500 ms transient in < 50 ms; real-time mode ≥ 60 fps for circuits up to 300 parts. |
| **Embeddable** | One core library used by the desktop app (native), the CLI, and the browser preview (WebAssembly). |
| **Explainable** | Every failure points to a part or net ("singular matrix: node TRIG has no DC path to ground → C1"). |

---

## 2. Where the engine sits

```
 Kirk code / schematic ──► Circuit IR (from the Kirk compiler)
                              │
                              ▼
   ┌──────────────────────── Space Bench Engine ────────────────────────┐
   │ 1 Elaborate   flatten subcircuits, number nodes, pick unknowns     │
   │ 2 Setup       instantiate device models, sparse pattern, ordering  │
   │ 3 Analyses    OP · TRAN · AC · DC · NOISE · real-time stepping     │
   │ 4 Drivers     sweep · Monte Carlo · temperature (parallel)         │
   │ 5 Output      columnar vector store + live ring buffers            │
   │ 6 Measure     .meas-style functions, FFT, THD, statistics          │
   └────────────────────────────────────────────────────────────────────┘
                              │
          plots · instruments (scope, DMM, Bode) · data export
```

---

## 3. Formulation: Modified Nodal Analysis (MNA)

Unknown vector **x** = node voltages (ground excluded) + branch currents of elements that need them: voltage sources, inductors, controlled sources with voltage outputs, and current-sense elements.

Each element **stamps** its contribution into the Jacobian **G** and the right-hand side **b**, giving `G·x = b`.

| Element | Stamp (n+, n−, branch k) |
|---|---|
| Conductance g (resistor 1/R) | G[n+,n+] += g, G[n−,n−] += g, G[n+,n−] −= g, G[n−,n+] −= g |
| Current source I (n+ → n−) | b[n+] −= I, b[n−] += I |
| Voltage source V | G[n+,k] += 1, G[n−,k] −= 1, G[k,n+] += 1, G[k,n−] −= 1, b[k] = V |
| VCCS gm | G[n+,c+] += gm, G[n+,c−] −= gm, G[n−,c+] −= gm, G[n−,c−] += gm |
| VCVS, CCCS, CCVS | Standard MNA stamps using an extra branch row |
| Capacitor, inductor | Companion model per integration method (§5.2) |
| Nonlinear device | Linearised companion (conductances + equivalent current) at the current Newton iterate |

`gmin` (default 1e-12 S) is added from every nonlinear junction node to ground, so matrices stay non-singular.

---

## 4. Linear solver

- **Storage:** compressed sparse column (CSC); the **sparsity pattern is fixed** after setup.
- **Ordering:** approximate minimum degree (AMD) on the pattern, computed once per circuit topology.
- **Factorisation:** left-looking sparse LU with threshold partial pivoting. Steps:
  1. a **symbolic** analysis, once;
  2. a **numeric** refactorisation on every Newton iteration, reusing the pivot order while the pivots stay healthy;
  3. a full re-pivot only when a pivot falls below the threshold.
- **Complex variant:** for AC and noise, (G + jωC), with the same pattern.
- **Diagnostics:** a zero or near-zero pivot is mapped back to its unknown. The UI then shows which net or branch is singular, with likely causes: a floating node, a loop of voltage sources, or a cut-set of current sources.

---

## 5. Analyses

### 5.1 DC operating point
- **Newton–Raphson** on `F(x) = 0`, using the Jacobian from the device stamps.
- **Convergence** (per unknown):
  - voltages: `|Δv| < reltol·max(|v_new|,|v_old|) + vntol`
  - currents: `|Δi| < reltol·max(|i_new|,|i_old|) + abstol`
  - device currents must also be consistent between iterations.
- **Defaults:** reltol 1e-3, vntol 1 µV, abstol 1 pA, max 100 iterations.
- **Step limiting:** junction-voltage limiting (log-domain limiting of diode/BJT junction steps) and MOSFET gate-voltage limiting, which stop exponential overflow.
- **Homotopy fallbacks**, tried in order until one converges:
  1. gmin stepping (1e-2 → 1e-12 S);
  2. source stepping (0 → 100 %);
  3. pseudo-transient (add C to ground, march to steady state).

### 5.2 Transient
- **Integration methods:**
  - Backward Euler for the first step and after every breakpoint;
  - **trapezoidal** by default;
  - **BDF-2 (Gear-2)** as an option for stiff or ringing circuits.
- **Companion models:** a capacitor with method coefficient α becomes `g_eq = α·C/h` in parallel with `i_eq` taken from its history; an inductor is the dual of this.
- **Adaptive timestep** from the **local truncation error** (LTE) of charges and fluxes, estimated from divided differences. Proposed `h_next = h·(tol/LTE)^(1/(order+1))`, clamped to [h/8, 2h].
- **Breakpoints:** source corners (PULSE edges, PWL points) force a step to land exactly on them, then restart with Backward Euler.
- **Newton failure handling:** halve h, up to 10 times; then report "timestep too small" with the offending node.
- **Output:** values are interpolated to the user's print step; the raw accepted points are kept for accurate measurements.

### 5.3 AC (small-signal)
1. Solve the OP.
2. Each device contributes its small-signal admittances (conductances + jωC terms).
3. Solve the complex MNA at each frequency (lin / dec / oct spacing).
4. Results are complex vectors, so the UI can show magnitude in dB and phase.

### 5.4 DC sweep
Repeated OP solutions while stepping a source or parameter. Each point starts from the previous solution (continuation), which keeps it fast and stable.

### 5.5 Noise
Noise sources per device, with spectral densities:

| Source | Density |
|---|---|
| Resistor thermal | 4kT/R |
| Junction shot | 2qI |
| Flicker | KF·I^AF / f |

Output noise uses the **adjoint method**: one transposed solve per frequency gives the transfer from every noise source to the output. Input-referred noise = output / gain. The app integrates the result over a band.

### 5.6 Drivers: sweep, Monte Carlo, temperature
- These are outer loops that clone the setup (the pattern and ordering are reused) and change parameters.
- Runs execute on a **thread pool** (one engine instance per thread; no shared mutable state).
- **Monte Carlo** uses a seeded PRNG (PCG64), so results are reproducible. Tolerances are Gaussian (σ = tol/3) or uniform, per the Kirk `montecarlo` block.
- **Temperature** updates the temperature-dependent model parameters (Is, Vt = kT/q, resistor tc1/tc2) before each run.

### 5.7 Real-time mode (interactive)
- Fixed timestep h (default chosen so that 1 animation frame = N steps, with N adapting to keep 60 fps), using Backward Euler or trapezoidal.
- **Linear circuits:** factor once and re-solve with new right-hand sides (a very cheap step).
- **Nonlinear circuits:** at most 3 Newton iterations per step, warm-started from the previous step.
- **Live edits** (slider, switch click, value change) re-stamp only the touched elements and refactor, with no restart. A topology change re-runs setup in the background, then swaps it in atomically.
- **Outputs per frame:**
  - node voltages, driving the wire colours;
  - branch currents, driving the current-dot speed and direction;
  - device power, for overheating highlights;
  - instrument buffers.

---

## 6. Device models (our own implementations)

Each model implements one interface:

```rust
trait Device {
    fn setup(&mut self, ctx: &mut SetupCtx);                 // claim nodes, branches, matrix entries
    fn temperature(&mut self, t: f64);                       // update temperature-dependent params
    fn load(&self, x: &[f64], ctx: &mut LoadCtx);            // DC/TRAN: stamp G and b (Jacobian + RHS)
    fn ac_load(&self, op: &[f64], w: f64, ctx: &mut AcCtx);  // small-signal complex stamps
    fn noise(&self, op: &[f64], f: f64) -> Vec<NoiseSrc>;    // optional
    fn limit(&self, x_new: &mut [f64], x_old: &[f64]);       // optional step limiting
    fn truncation_error(&self, h: f64, ctx: &LteCtx) -> f64; // for adaptive timestep
}
```

| Model | v1 equations |
|---|---|
| Resistor | R(T) = R0·(1 + tc1·ΔT + tc2·ΔT²); thermal noise |
| Capacitor / inductor | Ideal, with an optional initial condition; mutual inductance via coupling k |
| Independent sources | DC, SIN, PULSE, PWL, EXP, AM, plus AC magnitude/phase |
| Controlled sources | VCVS, VCCS, CCCS, CCVS |
| Behavioural source | Expression of node voltages and branch currents. The Jacobian comes from **automatic differentiation** (forward-mode dual numbers), so user-written `behavior {}` blocks converge like built-in models. |
| Diode | Shockley `I = Is·(e^(V/(n·Vt)) − 1)` + series Rs + junction capacitance Cj(V) with forward-bias linearisation + transit-time diffusion charge + reverse breakdown (BV, IBV). LED and Zener are parameter sets of this model. |
| BJT | Phase 1: Ebers–Moll (transport form) with Early effect. Phase 2: Gummel–Poon subset (high-injection IKF, base resistance, junction capacitances, transit time). |
| MOSFET | Phase 1: square-law (Shichman–Hodges) with λ and body effect. Phase 2: a smooth charge-based model (EKV-style), so weak/strong inversion is continuous (better convergence). |
| Switch | Voltage- or user-controlled, with a smooth on/off transition (avoids discontinuities) |
| Op-amp, 555, regulators | **Macro-models written in Kirk** from the primitives above, e.g. the 555 = 2 comparators + SR latch + discharge transistor + divider |

**Model parameter sets** live in the Space Bench model library (one file per part family, in Kirk syntax). We fit them ourselves from datasheet curves (Is, n, Rs from the I–V curve; Cj from the capacitance curve…). A small fitting tool is part of Phase E7.

---

## 7. Output & measurements
- **Vector store:** columnar `f64` arrays per signal, plus a time or frequency axis, with complex arrays for AC. It is memory-mapped for large runs and exported to CSV / Parquet / MAT / HDF5 / JSON by the app.
- **Streaming:** lock-free ring buffers feed the scope and real-time views; the UI never blocks the solver.
- **Measurement engine** (the functions behind Kirk `measure`):
  - levels: avg, rms, pp, max/min, value at t or f;
  - timing: crossings, frequency/period/duty, rise/fall time, delay, settle, overshoot;
  - frequency domain: gain/phase at f, bandwidth/fc, phase and gain margin;
  - spectrum: FFT (windowed: Hann, Blackman-Harris, flat-top) with THD/SNR;
  - statistics: mean, σ, yield, histogram.

  All are computed on the accepted raw points with interpolation, not on a resampled grid.

---

## 8. Public API (Rust core, bindings for the app)

```rust
let ckt  = Circuit::from_ir(&ir)?;                 // IR comes from the Kirk compiler
let mut sim = Engine::new(ckt, Options::accurate());
let op   = sim.op()?;                              // OpResult: node voltages, branch currents, device info
let tr   = sim.tran(TranSpec { stop: 0.5, step: 20e-6, ..Default::default() })?;
let ac   = sim.ac(AcSpec::dec(50, 10.0, 100e3))?;
let f    = measure::frequency(&tr["V(OUT)"], 2.5)?;   // 6.86 Hz for the 555 example

// real-time
let mut rt = sim.realtime(RtSpec::fps(60))?;
rt.set_param("R2.value", 22e3)?;                  // live slider
let frame = rt.advance_frame()?;                  // voltages, currents, power for this frame
```

Bindings: Tauri/Electron native module for the desktop app, `wasm-bindgen` for the browser preview, a C ABI for other tools. All errors carry a `Diagnostic { code, message, part, net }`.

---

## 9. Validation plan

Each analysis must match **analytic results** or carefully documented reference values.

| Test circuit | Check | Tolerance |
|---|---|---|
| Resistor divider, superposition | Exact OP | 1e-9 relative |
| RC step response | v(t) = V(1 − e^(−t/RC)) | 0.1 % with default tolerances |
| RLC series, underdamped | Frequency and decay vs analytic | 0.5 % |
| RC low-pass AC | fc = 1/(2πRC) = 994.7 Hz, −3.01 dB, −45° | 0.1 % |
| Diode half-wave rectifier | Peak and conduction angle vs Shockley solution | 1 % |
| BJT common-emitter | OP vs hand calculation; gain vs gm·Rc | 2 % |
| 555 astable (macro-model) | f = 1.44/((R1+2R2)C) = 6.86 Hz, duty 52.4 % | 2 % (the formula itself is approximate) |
| Monte Carlo yield | Matches analytic normal-distribution yield | ±1 % at 10 k runs |
| Stress set | Floating nodes, V-loops, I-cut-sets, stiff circuits | Correct diagnostic, no crash |

Every bug fix adds a regression circuit. Performance benchmarks run in CI with fixed budgets (§1).

---

## 10. Implementation phases (part by part)

| # | Phase | Deliverables | Done when |
|---|---|---|---|
| E0 | Skeleton | Rust crate, IR import, node numbering, dense solver | Divider OP exact |
| E1 | Linear DC + AC | R, sources, controlled sources; sparse LU (AMD + pivoting); complex AC | RC low-pass AC matches §9 |
| E2 | Transient (linear) | C/L companions, BE/trapezoidal, LTE timestep, breakpoints | RC and RLC tests pass |
| E3 | Nonlinear DC | Newton, limiting, gmin/source stepping, diode model | Rectifier OP and edge cases pass |
| E4 | Nonlinear transient | Newton per step, step rejection; BJT/MOSFET phase-1 models | CE amplifier and rectifier transients pass |
| E5 | Real-time mode | Fixed-step loop, re-stamping, live params, frame outputs | 555 blinker animates at 60 fps; slider retune < 16 ms |
| E6 | Drivers & measure | Sweep, MC, temperature, thread pool; measurement library, FFT | Figma "Analysis" numbers reproduced (13.85/6.86/3.20/1.52 Hz; yield ≈ 90 %) |
| E7 | Model library | Behavioural sources with auto-diff; 555/op-amp macro-models; parameter fitting tool | 555 and op-amp examples run from the library only |
| E8 | Noise & polish | Adjoint noise; BJT Gummel–Poon subset; MOSFET smooth model; diagnostics UX | Noise of an RC matches 4kTR-based analytic value |

---

## 11. How we learn from existing simulators (legal & practical)

We study **how simulation is done**, then write our **own** code.

- **Theory sources:**
  - the SPICE2 thesis (Nagel, 1975);
  - Vlach & Singhal, *Computer Methods for Circuit Analysis and Design*;
  - Najm, *Circuit Simulation*;
  - Kundert, *The Designer's Guide to SPICE and Spectre*;
  - Davis, *Direct Methods for Sparse Linear Systems* (sparse LU / KLU);
  - device-model papers (Shockley, Ebers–Moll, Gummel–Poon, EKV).

  Algorithms and equations are not copyrightable; implementing them ourselves is clean.
- **Reading open-source simulators** to understand a technique is fine. **Copying their code** brings their licence with it:
  - permissive (BSD-style) code may be reused only with its copyright notice kept in our About/licences screen;
  - copyleft (GPL) code would force our whole app under the GPL.

  **Rule:** no copied code without a recorded licence check. The preferred path is clean-room re-implementation from the theory above.
- **Model parameters** for real parts come from datasheets and our own fitting, not from vendor model files with restrictive licences.

---

## 12. Open questions
1. **Core language:** Rust (recommended: speed, WASM, safety) or C++.
2. **Process model:** run the engine in-process or as a sidecar process (crash isolation)?
3. **Real-time vs accurate:** one shared device codebase (preferred) or a simplified real-time device set?
4. **Digital/mixed-signal:** an event-driven logic kernel later, coupled to the analog engine?
