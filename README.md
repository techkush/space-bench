# Space Bench

Circuit design and simulation desktop app: a shadcn/ui interface on Tauri 2, with the **KiCad symbol libraries** (22,905 parts) and **ngspice** as the simulator. Our own engine (`engine/`) and symbols can replace them later.

```
spicebench-app/
  engine/              sb-engine — our own simulator (Rust, MNA/Newton/transient/AC); kept for later
  apps/desktop/        Tauri 2 app
    src/               React + TypeScript + Tailwind + shadcn/ui (tokens from the Figma design system)
      lib/kicad.ts     loads KiCad symbols on demand (public/kicad/*.json.gz)
      lib/spice.ts     schematic → SPICE netlist (KiCad Sim.* fields, or inferred from the part)
      lib/models.ts    SPICE models: common BJTs/MOSFETs/JFETs/diodes/LEDs, op-amp, 555, regulators
    public/kicad/      generated from the KiCad libraries (scripts/build-kicad-symbols.mjs)
    src-tauri/         Rust shell; `ngspice_run` runs ngspice -b and parses the raw file
  scripts/             build-kicad-symbols.mjs
  vendor/              kicad-symbols clone (git-ignored; only needed to regenerate public/kicad)
  packages/            (next) kirk-syntax, kirk-compiler … — the Kirk language (docs/kirk-language-spec.md)
```

## Prerequisites
- Node 22+, pnpm
- Rust (rustup). In a new terminal run `source ~/.cargo/env` first (or add it to `~/.zshrc`).
- arduino-cli (for the Microcontrollers workspace): `brew install arduino-cli`.
- ngspice: `brew install ngspice` (macOS). The app looks in PATH, /opt/homebrew/bin and /usr/local/bin, or set `SPICEBENCH_NGSPICE`.

## Run
```sh
pnpm install            # from spicebench-app/ (or apps/desktop/)
pnpm dev                # builds the Rust side and opens the app (hot reload for UI and Rust)
```

## Test
```sh
pnpm test                 # editor + netlister + every example run end-to-end on ngspice (Vitest)
cargo test -p spicebench  # ngspice bridge (raw-file parser, RC transient/AC/OP)
cargo test -p sb-engine   # our own engine, validated against analytic solutions
```

## KiCad symbols
`public/kicad` is generated; to refresh it from the latest KiCad libraries run `pnpm kicad:symbols`.
The KiCad libraries are CC-BY-SA 4.0 with an exception for designs made with them (`public/kicad/LICENSE.md`).

## Simulation models
A part simulates if its symbol has KiCad `Sim.*` fields (the Simulation_SPICE library: VDC, VSIN, VPULSE, NPN, OPAMP …)
or if Space Bench can infer one: R/C/L/potentiometer, batteries, lamps/speakers/fuses (resistive), diodes, LEDs (colour from the value),
zeners (voltage from the name), BJTs/MOSFETs/JFETs (named models for 2N3904, 2N3906, 2N2222, BC547/557, BD139/140, TIP31/32,
2N7000, BS170, BSS138, IRF540N, IRFZ44N, IRLZ44N, IRF9540, 2N3819 …; otherwise a generic model, noted in the Inspector),
op-amps (any `Amplifier_Operational` part, per unit, GBW by family), 555 timers, 78xx/79xx/LDO/LM317 regulators and switches.
Other parts can be placed and wired; they're flagged "not simulated" and left out of the netlist.

## What works (milestone 1 — vertical slice)
- **Engine (phases E0–E3):**
  - nodal analysis with dense LU;
  - Newton–Raphson with junction limiting, gmin stepping and source stepping;
  - transient analysis (Backward Euler / trapezoidal, source breakpoints, step halving);
  - AC small-signal analysis;
  - devices: R, C, L, V/I sources (DC / SIN / PULSE / PWL), diode, VCCS, VCVS.
- **App:**
  - four example circuits drawn with Space Bench symbols;
  - one-click Simulate (F5) and live re-simulation when values change;
  - wires coloured by node voltage, with voltage tags and hover readouts;
  - oscilloscope and Bode plotter (uPlot) with automatic measurements, an operating-point view and a console;
  - inspector with SI-unit fields and a live-tune slider;
  - light and dark themes.

## Editor
| Action | How |
|---|---|
| Place a part | Click a tile in **Parts**, search the library, or press **R C L D Q V G N**; **A** / **⌘K** opens the part browser. Click to drop, keep clicking to place more, **Esc** to stop. Multi-unit ICs (LM358 …) continue with the next unit |
| Rotate / mirror | **⌘R** (or **R** while placing) · **X** |
| Duplicate | **⌘D** |
| Wire | **W**, click to start, click for corners (**/** flips the bend); ending on a pin or another wire finishes it; **Esc** / right-click stops |
| Select / move | Click, **Shift**-click to add, drag empty space to box-select; drag to move — attached wires stretch |
| Delete | **⌫** |
| Undo / redo | **⌘Z** / **⌘⇧Z** |
| Probe | **P**, click a wire (voltage) or a part (current) to add it to the scope |
| Pan / zoom | **Alt**-drag or middle mouse · scroll wheel · fit button |
| File | **⌘N** new · **⌘O** open · **⌘S** save (`.sbc` v2, JSON — interim format until Kirk files; v1 files convert on open) |

Nets come from the drawing: wire ends join whatever they touch (pins, wire ends, the middle of a wire), wires that only cross stay separate, net labels and power symbols with the same name join, GND/GNDA/Earth are node 0. The **ERC** badge lists problems (no ground, unconnected pins, duplicate references); simulation waits until they are fixed.

```sh
pnpm --filter desktop test   # connectivity + editing tests (Vitest)
```

## Kirk (our circuit language)
Press **⌘E** (or the **Kirk** tab in the title bar) for the code view: **Code / Split / Schematic**.
Typing compiles on the fly (≈ 5 ms) and redraws the schematic; drawing regenerates the code. Measurements and asserts
(`measure f = frequency(V(out), at: 2.5 V)`, `assert f in 6.5 Hz .. 7.2 Hz`) show their results inline after each run.
Spec: [`../docs/kirk-language-spec.md`](../docs/kirk-language-spec.md) (§17 = what is implemented).

## Simulation setup
⚙ next to the analysis picker: transient / AC / DC sweep / operating point, **parameter sweep** (list, linear, decade, octave),
**Monte Carlo** (tolerances from the Inspector, ±tol = 3σ, seeded), **temperature**, measurements and asserts.
Runs go to ngspice in parallel; the scope / Bode plotter overlay the trace family and the **Results** tab shows every run,
statistics (μ, σ, min … max) and the assert yield.

## Analysis & data
The **Analysis** tab in the title bar: every Simulate press and every sweep / Monte Carlo becomes a result set.
- **Results panel:** step family (runs), signals, and **math** traces written in Kirk (`V(out)*I(R1)`, `V(out)/V(in)`).
- **Plots:** Time, Bode, **FFT** (window, range, f₀, harmonics, THD), **X–Y**, **Histogram** of a measurement with spec limits taken from its asserts.
- **Measurements panel:** per-run `.meas` table, A/B cursors with Δ readouts, statistics (μ, σ, yield).
- **Report:** one HTML file with the circuit, plots, measurements, statistics, Kirk source and netlist.
- **Data export** (⤓ / CSV): source, signals, runs, from/to, resample Δt; **CSV, JSON, MAT** (MATLAB v4, readable by scipy);
  header with units, wide/long format, `.meas` summary, embedded netlist + settings; live preview; "Copy as Python (pandas)".

`pnpm dev` also lets the plain browser (http://localhost:5173) simulate: the Vite dev server runs ngspice (`vite-ngspice.ts`).

## Start screen & Settings
- **Start screen** (opens on launch; ⌘⇧H or the logo from the workspace): New schematic ⌘N, **New from code** ⌘⇧N,
  **Import** ⌘I (`.kirk`, or a SPICE netlist `.cir/.sp/.net` — R C L V I D Q M J, DC/AC/SIN/PULSE/PWL, `.tran/.ac/.op/.dc`;
  lines it cannot import are listed as comments), Open ⌘O; recent projects with previews (drafts included), examples by category,
  **Learn Kirk** (cheat sheet + starter programs), **Part library**, **Model database**, ⌘K search over projects, examples and parts.
- **Settings** (⌘,): start-up, theme (light/dark/system), schematic overlays, ngspice executable, run mode, parallel workers,
  RELTOL/ABSTOL/VNTOL/GMIN, integration method, auto-recovery from convergence errors, saving device currents, Kirk view and sync delay,
  probe behaviour, playback speed, keyboard shortcuts, licenses. Stored in localStorage (`sb-settings`).

## Simulation process (Runs)
The **Runs** tab (or click the status bar, or **Details** on a run toast) shows how each run turned the schematic into data:
seven stage cards with real timings (Schematic & ERC → Circuit IR → Models → Solver → Vectors & probes → Measure → Export),
a timeline with one bar per sweep / Monte Carlo run, the solver console, and run states — progress with **Pause / Stop**,
complete, recovered (auto-recovery retried with Gear + gmin stepping) and failed with **Show on schematic**, which selects the
parts the ngspice error points at (element and node names are mapped back to references). Run history keeps the last 30 runs.

## Instruments
Dock tabs: **Bench** (function generator, multimeter with V⎓ V~ A⎓ A~ true-RMS modes, oscilloscope and Bode plotter side by side —
the Bode **Sweep** runs an AC analysis in the background so the scope keeps its transient), Oscilloscope, Multimeter, Function gen,
Bode plotter (−3 dB edges from the peak, unwrapped phase, roll-off and order), **Spectrum** (FFT, window, harmonics, THD),
**Logic analyzer** (threshold with hysteresis, edges, frequency, duty), **Power meter** (V·I of every part, supplied vs dissipated,
resistor load vs rating) and **Curve tracer** (the part is swept on a test fixture with its own model: I_C–V_CE family for BJTs,
I_D–V_DS for FETs, forward I–V for diodes, with the circuit's operating point marked).
The right panel's **Instruments & data** tab lists every connection (FG, scope channels, DMM, Bode), records transients
(signals, trigger channel/edge/level, buffer) and exports the recording as CSV, and adds instruments.

## PCB
The **PCB** tab lays out the schematic on a two-layer board. Footprints are generated from KiCad footprint names
(DIP, SOIC, 0402–2512 chips, axial, radial, LED, TO-92, TO-220, SOT-23, pin headers) with KiCad pad numbering;
each part uses its own footprint field, its symbol's, or a default for its kind, and can be switched in the inspector.
New parts are auto-placed; drag to move, **R** rotate. Route by hand (**X**, click pad → points → pad, **V** via / layer)
or with the **auto-router** (A* on a 0.25 mm grid, both layers, clearance per net class, no vias in pads).
**DRC** runs live: unrouted connections (ratsnest), clearance and shorts, board edge, courtyard overlap, silk over pad.
**Auto-place** spreads parts over the board and pulls connected parts together (springs along nets). **Auto-router options**
(⚙): layers (both / top only / bottom only), grid, via and bend cost, order, rip-up and retry, one net or all, replace existing
tracks, auto label afterwards. **Auto label** (**L**) places every reference next to its part without overlapping pads, vias,
other references or the edge (drag a label to place it by hand, **R** while dragging turns it).
**Board size**: width × height, presets (Eurocard, Arduino shield, 10 cm fab limit…), **Fit to parts** with a margin, drag the
edge or corner (left / top edges keep the parts in place), corner radius, thickness and solder-mask colour; dimensions are drawn on the canvas.
**3D** (**3**): the board with its mask, copper, pads, holes and silkscreen, and a body for every part; orbit, top / front /
bottom views, hide parts, save an image.
**Export Gerbers** writes a zip: F/B copper, F/B mask, F paste, silkscreen, outline (Gerber X2) and an Excellon drill file —
checked with gerbonara, which reads every layer. The board is saved in the .sbc file (`doc.pcb`).

## Projects, components and libraries
**New project** makes one folder with everything: `circuits/*.kirk` (code + schematic layout + feeds —
the source of truth), `lib/*.kirk` (component libraries), `pcb/` (boards), `models/`, `results/`, a
`.sbproj` manifest and a cache. The workspace's **Project** tab shows the tree; ⌘S saves into the folder.

Kirk **components** are reusable parts with parameters and pins — they simulate as subcircuits and draw
as boxes:

```
library Filters version "0.2.0"
component RCLowPass(fc: Frequency = 1 kHz, c: Capacitance = 100n) {
    pins in, out, gnd
    R1 = R(1 / (2 * pi * fc * c))
    C1 = C(c)
    in -- R1 -- out -- C1 -- gnd
}
```

Use them with `import "lib/filters.kirk"` (a project library) or `import library "Filters"` (your own
libraries, ~/Documents/Space Bench/Libraries — managed on the **My Libraries** page: create, edit with live
checking, version, use in or copy into a project).

## Lab: feed data to the inputs, measure every part
**Lab** (title bar, opens its own window; needs a circuit without ERC errors) lists every input
of the open circuit — supplies and sources, sensors (LDR, photodiode, phototransistor, NTC/PTC,
microphone, LM35/TMP36), controls (pots, switches, buttons) and the room — and feeds them data
written in Kirk, saved with the circuit:

```
stimulus {
    seed: 7
    V1 = ramp(from: 12 V, to: 9 V, over: 40 ms)        // brown-out
    TH1 = walk(start: 24°C, sd: 0.6°C, every: 0.5 ms) // drifting temperature
    LDR1 = random(min: 1 lux, max: 10k lux, every: 2 ms)
    SW1 = square(low: 0, high: 1, period: 5 ms)
}
```

Signals: constants, `ramp step sine square random normal noise walk samples pwl`, combined with
`+ − * /`; CSV import. **Run** simulates with the feeds and reports, for every part, voltage,
current, power and a stress check against its ratings with derating (green < 90 %, yellow
90–100 %, red > 100 %, like PSpice Smoke); plots of each feed and of chosen signals; CSV export.
The AI can feed inputs too (`set_stimulus`).

## Microcontrollers (Arduino)

Start screen → **Microcontrollers** (or ⌘⇧A): an Arduino workspace in the style of
Wokwi / Velxio, fully local.
- **Write and wire:** the sketch in Monaco; a board (Uno, Nano, Mega 2560) and parts on the
  canvas. Wire by clicking a pin, then another.
- **Compile:** with your `arduino-cli` (⌘B); libraries listed in `libraries.txt` install
  themselves.
- **Run (⌘↵):** the real firmware runs on an emulated chip (avr8js) in a Web Worker, in
  real time. The circuit around it is solved electrically, so LEDs dim with PWM and
  missing resistors are flagged.
- **Parts:** LEDs, RGB, 7-segment, bar graph, buzzer (you hear it), servo, LCD 16×2 / 20×4
  (I²C or parallel), SSD1306 OLED, NeoPixel, buttons, switches, pots, joystick, NTC,
  LDR, PIR, HC-SR04, DHT22.
- **Serial Monitor** with input. **AI assistant** that writes the sketch and the wiring,
  compiles, runs and reads the Serial output.
- **Files:** a sketch is a folder with `sketch.ino`, `diagram.json` (Wokwi format, so it
  copies to and from Wokwi) and `libraries.txt`. It lives in a project's `firmware/` or in
  `~/Documents/Space Bench/Sketches/`.

- **Boards:** Arduino Uno / Nano / Mega (avr8js), **Raspberry Pi Pico** (rp2040js, with USB serial and PIO), **ESP32 DevKit** (Espressif's QEMU, with a pin bridge over UART2).
- **Breadboards:** parts seat into the holes and connect.
- **Check with ngspice:** every part's current, voltage and power at that instant.
- **Logic Analyser:** pin traces, frequency and duty, VCD export.
- **Imported Fritzing parts** (.fzpz).

Needs `arduino-cli` (`brew install arduino-cli`). The page installs the board cores for you (AVR, RP2040, ESP32). The ESP32 also needs Espressif's QEMU (Settings → Microcontrollers → Install, or ESP-IDF's).
See `plan-03.md` for what comes next (Pico, ESP32, Raspberry Pi, breadboard, ngspice check).

## AI assistant
**AI** (title bar, the Kirk panel, or ⌘J in the desktop app) opens a chat beside the Kirk editor. Describe a circuit, ask for a
change, or attach / paste / drop a picture of a schematic: Claude writes the Kirk program (the schematic draws itself), simulates
it on ngspice, reads the numbers, fixes what is off, and connects probes or the multimeter when you ask ("probe the output").
Tools it uses: read the circuit, write Kirk, simulate (tran / AC / OP / DC), measure, add / remove probes, set the meter,
search the KiCad library. Nothing is sent until you press Send.

Two ways to connect (Settings → AI Assistant, or the chip in the panel header):
- **Claude Code CLI** (default) — runs `claude -p` with your Claude Code login; no API key. Claude Code's own tools are
  switched off (`--tools ""`, no MCP, no settings) and it runs in an empty temp folder; Space Bench's tools travel as
  `<tool …>` tags (`src/lib/ai/claudecode.ts`), and each chat is one resumed CLI session. The **terminal** pane in the
  panel shows every command, session, reply and cost line live. The desktop app runs it via Rust
  (`src-tauri/src/claude_code.rs`); `pnpm dev` in a browser uses the dev endpoint `/api/claude` (`vite-claude.ts`).
  Install: `npm install -g @anthropic-ai/claude-code`, then run `claude` once to log in.
- **Anthropic API key** — calls the Messages API directly (`src/lib/ai/claude.ts`).

## Next milestones
1. **PCB next:** footprints from the KiCad footprint library, copper pours / ground planes, push-and-shove routing, 3D view.
2. **Kirk next:** comment-preserving code patches, `component` definitions with drawn symbols, `for` generators, instruments as code.
3. **Engine E4–E5:** BJT/MOSFET models, sparse LU, adaptive timestep from truncation error, real-time mode with current-flow animation.
