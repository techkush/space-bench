# Space Bench

**Design, simulate and build electronics in one desktop app — schematics, SPICE simulation, a circuit language, instruments, PCB layout and microcontrollers.**

Space Bench is a free, local-first circuit workbench, developed on macOS (it is built with Tauri, which also targets Windows and Linux — those builds are untested so far). Draw a schematic with the full KiCad symbol library or write it as code in **Kirk**, simulate it on **ngspice**, measure it with virtual instruments, lay out a PCB and export Gerbers — and program Arduino, Raspberry Pi Pico and ESP32 boards whose real firmware runs in an emulator next to the circuit.

> **Status:** early development (v0.1). Everything below runs today, but file formats and APIs may still change.

---

## Features

### Schematic capture
- **22,905 KiCad symbols** loaded on demand, with a searchable part browser and favourites.
- Wiring that follows KiCad's rules (wire ends join, crossings don't, labels and power symbols connect by name), ERC, undo/redo and multi-unit ICs.
- Inspector with SI-unit fields, tolerances and a live-tune slider for any value.

### Simulation (ngspice)
- Transient, AC, DC sweep and operating point — run through **libngspice** inside the app, or `ngspice -b`.
- **Live mode:** change a value and the circuit re-simulates instantly; wires are coloured by voltage and LEDs, lamps, motors and speakers react.
- Parameter sweeps, Monte Carlo (from part tolerances) and temperature runs, overlaid on one plot.
- Models for common BJTs, MOSFETs, JFETs, diodes, LEDs, op-amps, 555s and regulators are inferred from the part value; anything with KiCad `Sim.*` fields simulates as-is.

### Kirk — circuits as code
- A small language (`.kirk`, after Kirchhoff) that describes a circuit; the schematic draws itself and stays in sync both ways.
- Components (reusable sub-circuits with parameters), libraries and imports, measurements and pass/fail checks, `stimulus { }` blocks that feed data to inputs.
- Spec: [`docs/kirk-language-spec.md`](docs/kirk-language-spec.md).

### Analysis and instruments
- Oscilloscope, Bode plotter, multimeter, spectrum analyser (FFT/THD), logic view, power table and curve tracer.
- Analysis view for result sets, CSV / JSON / MATLAB export and an HTML report.
- **Lab window:** list every input (supplies, sensors, controls), drive them with ramps, noise, random walks or CSV data, and check every part's voltage, current and power against its ratings.

### PCB
- Parametric footprints, smart placement, ratsnest, an A\* auto-router, design-rule checks and a 3D board view.
- **Gerber X2 + Excellon** export, validated with gerbonara.

### Microcontrollers
- A Wokwi-style workspace: write the sketch in Monaco, wire boards and parts on a canvas, compile with your `arduino-cli`, and run the real firmware in real time.
- **Arduino Uno / Nano / Mega** (avr8js), **Raspberry Pi Pico** (rp2040js, with USB serial and PIO) and **ESP32** (Espressif's QEMU with a GPIO bridge).
- A catalogue of **472 parts** (354 simulated): sensors, displays, motors, I²C chips, logic, passives and more. Breadboards, a Serial Monitor, a logic analyser with VCD export, Fritzing part import, several boards per sketch, and a "Check with ngspice" that simulates the running circuit.

### AI assistant (optional)
- Describe a circuit or paste a picture of a schematic: Claude writes the Kirk program, simulates it, reads the numbers and fixes what is off. In the microcontroller workspace it writes the sketch and the wiring.
- Uses your Claude Code login (`claude -p`) or an Anthropic API key. Nothing is sent until you press **Send**.

---

## Getting started

### Prerequisites
| Tool | Why | Install (macOS) |
|---|---|---|
| Node.js 22+ and pnpm | the UI | `brew install node pnpm` |
| Rust (stable, 1.90+) | the desktop shell | [rustup.rs](https://rustup.rs) — then `source ~/.cargo/env` |
| ngspice | circuit simulation | `brew install ngspice` |
| arduino-cli *(optional)* | compiling sketches | `brew install arduino-cli` |
| Espressif QEMU *(optional)* | running ESP32 sketches | Settings → Microcontrollers → Install |

The app looks for ngspice in `PATH`, `/opt/homebrew/bin` and `/usr/local/bin`; set `SPICEBENCH_NGSPICE` to use another one. Board cores (AVR, RP2040, ESP32) are installed from the Microcontrollers page.

### Run
```sh
git clone https://github.com/techkush/space-bench.git
cd space-bench
pnpm install
pnpm dev          # builds the Rust side and opens the app, with hot reload
```

`pnpm dev` also serves the UI at <http://localhost:5173>. In a browser, the dev server stands in for the desktop commands (ngspice, arduino-cli, QEMU), so almost everything can be tried there too.

### Build an installer
```sh
pnpm build        # tauri build → apps/desktop/src-tauri/target/release/bundle
```

### Test
```sh
pnpm test                      # Vitest: editor, netlister, Kirk, PCB, examples end-to-end on ngspice, microcontrollers
cargo test -p spicebench       # the ngspice bridge
cargo test -p sb-engine        # our own simulation engine, against analytic solutions
```
Some microcontroller tests compile sketches against real Arduino libraries and are skipped unless `SB_ARDUINO_USER` points at a scratch sketchbook — see the header of `apps/desktop/src/mcu/catalog/devices.test.ts`.

---

## Repository layout
```
apps/desktop/                 the Tauri 2 app
  src/
    components/               React UI (shadcn/ui + Tailwind v4)
    editor/                   schematic model, netlist, file format, examples
    kirk/                     the Kirk language: lexer, parser, compiler, generator, auto-layout
    lib/                      ngspice bridge, SPICE netlister and models, results, instruments, projects, AI
    lab/                      the Lab window
    pcb/                      footprints, placement, router, DRC, Gerber export, 3D models
    mcu/                      microcontroller workspace: emulators, circuit solver, parts catalogue
  src-tauri/                  Rust shell: ngspice (program + libngspice), arduino-cli, QEMU, Claude Code
  public/kicad/               KiCad symbols, converted (generated by scripts/build-kicad-symbols.mjs)
engine/                       sb-engine — our own simulator in Rust (MNA, Newton, transient, AC); for later
scripts/                      build-kicad-symbols.mjs
docs/                         user guide, Kirk language spec, engine spec
plan-02.md, plan-03.md        roadmaps and status
```

## Documentation
- [User guide](docs/user-guide.md) — editor shortcuts, simulation models, Kirk, Lab, PCB, microcontrollers, AI.
- [Kirk language spec](docs/kirk-language-spec.md)
- [Engine spec](docs/engine-spec.md)
- Roadmaps: [plan-02.md](plan-02.md) (simulator, releases) · [plan-03.md](plan-03.md) (microcontrollers)

## Roadmap
- Ship ngspice and arduino-cli with the installer, signed and notarised, with auto-update.
- Mixed-signal simulation with XSPICE digital models.
- KiCad and LTspice import/export.
- More boards (ATtiny85, Raspberry Pi 3, Pico W Wi-Fi), a library manager, on-chip debugging and upload to real hardware.
- Our own simulation engine and symbols as an alternative to ngspice and KiCad.

## Contributing
Issues and pull requests are welcome. Please run `pnpm test` before opening a PR, and keep third-party code to permissively licensed sources (see below) — never copy code from GPL or AGPL projects into the app.

## Licence
A licence for Space Bench's own code has not been chosen yet. Until one is added, all rights are reserved by the author.

Third-party parts keep their own licences:

| Component | Licence | Used for |
|---|---|---|
| [KiCad symbol libraries](https://gitlab.com/kicad/libraries/kicad-symbols) | CC-BY-SA 4.0 with a design exception ([`public/kicad/LICENSE.md`](apps/desktop/public/kicad/LICENSE.md)) | schematic symbols |
| [ngspice](https://ngspice.sourceforge.io) | BSD-3-Clause (mostly) | simulation, run as a separate program or shared library |
| [avr8js](https://github.com/wokwi/avr8js), [rp2040js](https://github.com/wokwi/rp2040js), [@wokwi/elements](https://github.com/wokwi/wokwi-elements) | MIT | AVR and RP2040 emulation, part drawings |
| RP2040 B1 boot ROM | BSD-3-Clause (Raspberry Pi) | booting Pico firmware |
| [Monaco Editor](https://github.com/microsoft/monaco-editor) | MIT | sketch editor |
| [arduino-cli](https://github.com/arduino/arduino-cli) | GPL-3.0, run as a separate program | compiling sketches |
| [Espressif QEMU](https://github.com/espressif/qemu) | GPL-2.0, run as a separate program | ESP32 emulation |
| [Tauri](https://tauri.app), [React](https://react.dev), [shadcn/ui](https://ui.shadcn.com), [uPlot](https://github.com/leeoniya/uPlot), [three.js](https://threejs.org) | MIT / Apache-2.0 | the app |
| Fritzing part fixture (US-100) | CC-BY-SA 3.0 | an import test |
