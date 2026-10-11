# Space Bench — Plan 02: more functions, production level

Goal: turn Space Bench from a capable prototype into an app people can install, trust and
learn with. Work goes phase by phase; each item lists its design, what "done" means, and
how it is verified. Status: ☐ todo · ◐ in progress · ☑ done.

---

## Phase 1 — Live, interactive simulation

### 1.1 ☑ Embed ngspice as a shared library (`libngspice`) — done 2026-10-11
Today every run spawns `ngspice -b`, writes a raw file and parses it. The shared library
([ngspice docs](https://ngspice.sourceforge.io/shared.html)) runs in a background thread,
streams every time point, and can be halted, altered and resumed.

Design
- Rust `src-tauri/src/ngspice_lib.rs`: load the library at runtime (`libloading`), so the
  app still starts — and falls back to the CLI — when it is missing. Search: Settings path →
  bundled resource → `/opt/homebrew/lib`, `/usr/local/lib`, Linux lib dirs, `ngspice.dll`.
- One engine instance (ngspice is not re-entrant): a worker owns it; runs are serialised;
  a new run halts the previous one (`bg_halt`) — what Live mode needs.
- `ngSpice_Circ` loads the deck, `bg_run` starts it; `SendData` streams points, emitted
  to the UI (throttled ~30/s) as `ngspice://progress { run, t, fraction }` and, for
  transients, `ngspice://points { run, time[], data[][] }`.
- At the end, vectors are read with `ngGet_Vec_Info` into the **same JSON** the CLI path
  returns (same `signal_name` mapping), so the UI and tests don't change.
- New commands: `ngspice_lib_info` (version, path), `ngspice_halt(run)`,
  `ngspice_alter(run, device, param, value)` + `ngspice_resume(run)` (used by 1.2).
- Settings → Simulation Engine: "Engine: Library (fast, live) / Program (ngspice -b)",
  auto = library when found.

Done when: RC / AC / OP / DC results match the CLI path within 1e-9 (Rust test, both
paths); Stop halts a long transient in < 100 ms; the Runs view shows live progress; the
app falls back to the CLI when the library is absent.

Result
- `src-tauri/src/ngspice_lib.rs`; commands `ngspice_run` (engine auto/library/program,
  run name, live), `ngspice_halt`, `ngspice_alter`, `ngspice_lib_path`; Settings →
  Simulation Engine → Engine; toolbar shows % for single runs; Stop halts library runs.
- Only Live runs are interruptible (a new Live run halts the old one); sweeps/Monte Carlo
  use the program in Automatic so they keep running in parallel.
- Tests (Rust): library ≡ program for tran / ac / op / dc (1e-9), parse error, halt by the
  next run; benchmark (`cargo test --release bench::speed -- --ignored`):
  **4.5 ms/run library vs 18.9 ms/run program** (RC, 1000 points).
- Found: an empty circuit (all lines ignored) crashes libngspice → any "ignored" line is
  now an error before the run. Risk: a crash inside libngspice ends the app — consider an
  out-of-process worker (2.x) if field reports show crashes.
- Not yet: the `ngspice://points` stream is emitted but no view draws it live (→ 1.2 live
  scope); `ngspice_alter` exists but is not used until 1.2's live controls.

### 1.2 ☑ Environment room and input parts — done 2026-10-11
A panel where the circuit's surroundings are set, and parts that read them.
- **Environment**: light (lux), temperature (°C), sound level (dB SPL), magnetic field,
  supply noise. Kirk: `environment { light: 300 lux, temp: 25 °C }`; saved in the doc.
- **Sensors** (each = a SPICE model driven by the environment):
  LDR / photoresistor (R = R10·(lux/10)^-γ), photodiode (current ∝ lux), thermistor NTC
  (β model), temperature sensor (LM35-like 10 mV/°C), microphone (signal ∝ sound level),
  Hall sensor, PIR / IR (digital out).
- **Controls you move live**: potentiometer, slider, volume knob, rotary encoder, switch,
  push button, DIP switch, keypad. Drawn as widgets on the schematic; drag = `alter` +
  resume (1.1), so waveforms keep running.
- Kirk constructors: `LDR()`, `Photodiode()`, `Thermistor(10k, beta: 3950)`, `TempSensor()`,
  `Mic()`, `Hall()`, `Slider(10k, pos: 0.3)`, `Knob(…)`, `Button()`, `Switch()`.
- AI tools: `set_environment(light|temp|sound…)`, `set_input(part, value)`; prompt
  examples: "make the room dark and check the night-light turns on".

Done when: a night-light (LDR + transistor + LED) responds to the light slider live;
a thermostat example switches at its set point; Kirk round-trips the environment block;
AI can change the environment and read the result.

Result
- `lib/environment.ts` (room model + sensor physics), sensors in `lib/spice.ts` (LDR, NTC/PTC,
  photodiode, phototransistor, microphone, LM35/TMP36); room temperature becomes `.temp`
  only when set (default 27 °C = SPICE's, so old circuits are unchanged).
- Kirk: `environment { light: … lux  temp: …°C  sound: … dB  tone: … Hz }` (units checked),
  constructors LDR Photodiode Phototransistor Thermistor PTC Mic TempSensor Slider Knob Button
  (+ Buzzer/Motor fixed); all round-trip.
- UI: Room tab (room picture, sliders + presets, every input with its control, paused/manual
  hint); on-canvas chips — switch ON/OFF, hold-to-press button, pot − / + / scroll, sensor
  readings — placed clear of labels and pins; a drag is one undo step, a button press none.
- AI: `set_environment`, `set_input` tools + prompt section.
- Examples (Sensors): Night light, Thermostat fan, LED dimmer — behaviour tested on ngspice.
- Changed from the design: inputs re-run the circuit (≈5 ms with 1.1) instead of
  `alter` + resume, so every analysis works; alter stays available for long transients.
- Not yet: Hall / PIR / keypad / rotary encoder; a magnetic-field room property.

### 1.2b ☑ Lab window: feed data to inputs, measure every part (user redesign, done 2026-10-11)
The Room tab is replaced. Feedback: the room picture is not wanted; there are many kinds of
input, not only light/temperature/sound; data should be fed by Kirk code; supplies and sources
are inputs too; the results must show what happens to every part; needs its own window.

Research
- PWL data feeds (LTspice / Cadence import time-value tables or CSV into sources).
- Time-varying resistance needs a behavioural source in ngspice (R can't use `time`).
- PSpice *Smoke*: compare each part's V / I / P with its maximum ratings × derating;
  green < 90 %, yellow 90–100 %, red > 100 %.

Design
- Kirk `stimulus { target = signal … }` — targets: a source (`V1`, `I1`, `BT1`), a sensor's input
  (`TH1`, `LDR1.light`), a control (`RV1`, `SW1`), the whole room (`room.temp`); signals:
  constants, `ramp step sine square random normal noise walk samples pwl`, with `+ − × ÷`,
  seeded (`seed: 7`). `environment { }` still parses (→ room feeds).
- Netlist: constant feeds keep the static models; time-varying feeds become PWL signal
  nodes driving behavioural sensors / sources (an inline 0 V ammeter keeps `I(ref)`).
- `lib/stress.ts`: per-part V / I / P stats and ratings (R power, C voltage, LED / diode current
  and reverse voltage, BJT / MOSFET Ic, Vce, Pd) with derating → ok / warn / over.
- Lab window (own OS window, `?view=lab`): inputs of the open circuit (sources, sensors,
  controls) with their feeds and previews; a Kirk editor for the stimulus block; Run;
  results: parts table (stress + stats), signal plots, CSV export. Synced with the main
  window (BroadcastChannel); opens only for an error-free circuit. Room tab removed.
- AI: `set_stimulus(target, signal)`.

Result
- `lib/stimulus.ts` (signals, seeded random, PWL sampling), `lib/feeds.ts` (input catalogue,
  feed resolution, problems), `lib/stress.ts` (stats + Smoke-style checks), `lab/LabApp.tsx`
  (window), `lib/labLink.ts` (BroadcastChannel + Tauri WebviewWindow "lab"), Lab button in the
  title bar (disabled with the reason when the circuit has ERC errors). Room tab removed; sensor
  chips open the Lab. Sensors examples now carry feeds (dusk, drifting temperature, slider sweep).
- Verified on ngspice: dusk ramp turns the night light on; 5 V → 3 V sag tracked; seeded noise
  reproducible; 47 Ω LED resistor flagged over; thermostat fan cycles with a drifting temperature.
- Browser: Lab linked to the circuit, brown-out feed added from the menu, run 40 ms, parts table,
  feed + circuit plots, feeds synced back into the circuit's Kirk. Found + fixed: motors/lamps were
  judged as ¼ W resistors.
- Next ideas: pick a run per feed set (A/B compare), Monte Carlo over feeds, CSV with headers.

### 1.2c ☑ All room properties + analog sensor catalogue (done 2026-10-11)
`lib/sensors.ts`: 15 room properties (light temp sound tone humidity pressure field distance force
accel gas motion touch level moisture) and 16 analog sensors (FSR, gas element / module, moisture,
level, humidity, 40PC pressure, A1301/A1302 Hall, A110x Hall switch, IR distance, accelerometer,
PIR, AT42QT1010 touch, load cell, ACS7xx current) — response curves → ngspice `pwl()` tables;
built-in symbols SpaceBench:SensorModule / LoadCell. Kirk units Pa, T, cm, mm, N, g. Tests: every
sensor's direction on ngspice + datasheet checks (humidity, Hall 25 mV/mT, bridge 2 mV/V, ACS 185 mV/A).
Digital (I²C/SPI) sensors wait for 3.2.

### 1.4 ☑ Auto-layout: AI / Kirk circuits drawn as wired schematics (done 2026-10-11)
`kirk/autolayout.ts`: signal-flow columns, rails as power symbols at each pin, orthogonal wires
(L / dog-leg / tree, A* maze fallback), sections side by side for large circuits (high-fanout
nets labelled), reconcile() labels anything unroutable. Code without a `layout { }` block is laid
out. Examples route fully except one 555 branch.

### 1.3 ☑ Output parts react (done 2026-10-11)
LED / lamp glow by current, speaker & buzzer play through the computer, motor spins.
Next: 7-segment display, LED bar / matrix, relay click, servo angle, LCD 16×2 (needs 3.x).

---

## Phase 1.5 — Projects and Kirk 2 (user request, 2026-10-11)

### 1.5.1 ☑ Components (classes) in Kirk — done 2026-10-11
`component Name(param: Type = default, …) { pins a, b, c   <parts and connections>   symbol box(…) }`
— parameters with units and defaults (numbers, expressions, strings such as transistor models),
used like any part (`F1 = Name(r: 2k)`, pins `F1.out`, chains `IN -- F1(in→out) -- OUT`), nested
components. Each parameter set compiles once to an ngspice `.subckt` (cached in the document);
the symbol is a generated box. Kirk keeps the definitions verbatim when the drawing changes.

### 1.5.2 ☑ Libraries and imports — done 2026-10-11 (`use … as` alias still to do)
`library Filters version "1.0.0"` files of components. `import "lib/filters.kirk"` (project),
`import library "Filters"` (user library folder ~/Documents/Space Bench/Libraries/Filters/).
`use Filters.RCLowPass as LP`. Library manager: create, edit, version, add to a project.

### 1.5.3 ☑ Project folders — done 2026-10-11
```
MyProject/
  MyProject.sbproj          manifest: name, version, main circuit, libraries, created/modified
  circuits/main.kirk        the circuit: code + schematic layout + feeds (source of truth)
  pcb/main.board.json       board layout of that circuit
  lib/*.kirk                project component libraries
  models/                   SPICE model files (.lib / .mod)
  results/                  Lab exports, run data
  .spacebench/main.json     cache: exact document snapshot for fast, lossless opening
```
New / Open project, a project tree in the workspace, save writes every file, recent projects.

### 1.5.4 ☑ Library manager UI — done 2026-10-11
My Libraries page (create, edit, delete, use in / copy into the project), library editor (code checked
as you type, component cards with symbols, version bump), project panel (tree, new circuit / library,
Show in Finder). Code: `kirk/components.ts`, `lib/project.ts`, `lib/libraries.ts`, `lib/projectfs.ts`,
`components/{ProjectPanel,LibraryEditor,LibrariesPage,NewProjectDialog}.tsx`. Tests: components on
ngspice (two instances, nesting, expressions, text parameters, imports, Inspector edits), projects
(create / save / cache / reopen, project and user libraries).
Not yet: drawing your own symbol (`symbol` blocks, spec §6.5), `behavior` blocks (§6.3), `use … as`,
double-click an instance to open its definition, git-friendly project diffs.

## Phase 2 — Production release

### 2.1 ☐ Bundle ngspice
Ship `libngspice` (+ code models) inside the app for macOS (arm64/x64), Windows, Linux;
the Homebrew install becomes optional. Check the ngspice licence (BSD) notice in About.

### 2.2 ☐ Signing, notarisation, installers
macOS Developer ID signing + notarisation; Windows Authenticode (avoid SmartScreen);
Linux AppImage/deb. CI (GitHub Actions) builds all three on tag.

### 2.3 ☐ Auto-update
`tauri-plugin-updater` with our signing key, a static update feed, staged rollout,
"what's new" after updating.

### 2.4 ☐ Crash and error reports (opt-in)
`tauri-plugin-sentry` for Rust + web; off by default, asked once; never sends circuits,
Kirk code, file paths or API keys. A "Report a problem" item in Help.

### 2.5 ☐ Tests that guard releases
- Simulation regression suite: reference circuits with known answers (RC corner, gain,
  ripple, oscillator frequency, regulator line/load) — fails on drift.
- End-to-end with WebdriverIO + tauri-driver: open example → simulate → probe → export;
  PCB route → Gerber; AI flow with a scripted model; Claude Code with a fake runner.
- Performance budgets: open 200-part schematic < 1 s, live re-run < 150 ms for examples.

### 2.6 ☐ Files you can trust
Versioned project format with migrations, autosave + crash recovery, backup before
overwrite, "recover unsaved work" on start.

### 2.7 ☐ Security hardening
Tauri capabilities limited to the commands used; strict CSP; API key in the OS keychain
(Keychain / Credential Manager / Secret Service) instead of localStorage; Claude Code runs
with tools off (done).

### 2.8 ☐ Accessibility and languages
Keyboard path for every action, screen-reader labels, contrast-checked plot colours,
reduced motion; strings extracted for translation (i18n), first: English, Sinhala.

---

## Phase 3 — Digital and microcontrollers

### 3.1 ☐ Mixed-signal with XSPICE
Use ngspice's XSPICE digital models ([XSPICE](https://ngspice.sourceforge.io/xspice.html)):
74xx / 4000 gates, flip-flops, counters, ADC/DAC bridges. Logic analyzer reads real
digital nodes; Kirk `digital { }` block.

### 3.2 ◐ Arduino / AVR — circuit + firmware in one workspace (branch `all-in-one-workspace`, 2026-10-11)
Write a sketch (or Kirk `firmware { }`), compile with avr-gcc, run on the AVR model coupled
to the analog circuit; serial monitor; LED / button / sensor parts from 1.2 connect to pins.

Done:
- KiCad `MCU_Module:Arduino_UNO_R2/R3`, `Arduino_Nano_v2.x/v3.x` and `RaspberryPi_Pico(_W)` are
  programmable parts (`src/cosim/boards.ts`): symbol pin names map to chip pins (D13 → 13,
  SDA/A4 → A4, GPIO26_ADC0 → GP26), +5V / 3V3 / IOREF / VBUS are supplies (50 mΩ), GND is ground.
  A plain run sees the board as its supplies; unused header pins don't raise ERC warnings.
- Each board's sketch is saved in the circuit (`doc.firmware[ref]`), kept across Kirk edits.
- Lockstep co-simulation (`src/cosim/cosim.ts`): the chips run a 20 ms frame (avr8js / rp2040js in
  one worker per board, `chip.worker.ts`); their pin edges become PWL sources behind 25 Ω, pull-ups
  35 kΩ / pull-downs 50 kΩ, and a behavioural source when a pin changes between input and output;
  ngspice runs the frame from the previous node voltages (`.ic`); input pins read the end
  voltages with Schmitt thresholds (0.3 / 0.6 Vcc), ADC pins their volts. Pins with > 400 edges in
  a frame are averaged.
- UI: Firmware panel next to the schematic (sketch, libraries.txt, Compile, Run/Stop, Serial
  Monitor, compiler output); Simulate runs circuit + firmware when the circuit has a board and the
  analysis is Transient. The scope / wires / LEDs show a rolling 2 s window and the frame averages.
- Example "Arduino PWM DAC"; tests `src/cosim/cosim.test.ts` (PWM → RC → A0 ≈ 512; INPUT_PULLUP vs
  1 kΩ reads LOW and lights an LED at ~12 mA; the example runs its own sketch).

Not yet: Kirk `firmware { }`; ESP32 (QEMU) and the catalogue's other boards in schematics;
inputs read within the same frame (now one frame late); inductor current across frames; I²C/SPI
devices drawn as schematic parts (they need bus models on the ngspice side); speed — in the
browser (ngspice per frame over the dev server) ~30 % of real time.

---

## Phase 4 — Working with others

### 4.1 ☐ KiCad / LTspice interchange
Export `.kicad_sch` + `.kicad_pcb`; import KiCad schematics and LTspice `.asc`
([KiCad formats](https://dev-docs.kicad.org/en/file-formats/)).

### 4.2 ☐ Vendor SPICE models
Import `.lib` / `.mod` / `.subckt` files, map pins to a symbol, keep them in a user library.

### 4.3 ☐ Share
Read-only share link (circuit + results), comments, embed in docs.

### 4.4 ☐ Docs and tutorials
User guide, Kirk reference, in-app guided tutorials (first circuit, filters, transistors,
555, op-amps), release notes.

---

## Order of work
1.1 → 1.2 → 1.5 → 2.1 → 2.5 → 2.6 → 2.2 → 2.3 → 2.4 → 2.7 → 3.1 → 2.8 → 3.2 → 4.x

## Log
- 2026-10-11 — plan written; 1.1 done (library engine, 4× faster, tests).
- 2026-10-11 — 1.2 done (room, sensors, live controls, AI tools, 3 examples).
- 2026-10-11 — 1.5 projects + Kirk components + libraries done.
- 2026-10-11 — user redesign → 1.2b Lab window done; Lab export menu; 1.2c sensors; 1.4 auto-layout; right panel only on selection; Datasheet button only with a link (opener plugin). Next: 2.1 bundle ngspice.
