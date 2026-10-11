# Space Bench — Plan 03: the microcontroller workspace

Goal: a second way to work in Space Bench, modelled on [Velxio](https://velxio.dev) and
[Wokwi](https://wokwi.com): write firmware, wire parts to a board on a canvas, and run the
**real compiled program** on an emulated chip, with the circuit around it solved
electrically. Free and open source, all local: no account, no server.

Status: ☐ todo · ◐ in progress · ☑ done.

## Licensing

Velxio itself is **AGPL-3.0** (with a separate commercial licence). Space Bench does not copy
its code. It is built on the same open-source building blocks, which are permissively
licensed:

| Building block | Licence | Used for |
|---|---|---|
| [avr8js](https://github.com/wokwi/avr8js) | MIT | ATmega328P / ATmega2560 emulation |
| [@wokwi/elements](https://github.com/wokwi/wokwi-elements) | MIT | boards and parts on the canvas |
| [rp2040js](https://github.com/wokwi/rp2040js) | MIT | Raspberry Pi Pico (phase 2) |
| [Monaco Editor](https://github.com/microsoft/monaco-editor) | MIT | the code editor |
| [arduino-cli](https://github.com/arduino/arduino-cli) | GPL-3.0, run as a separate program | compiling sketches |

Wokwi's `diagram.json` format is used as-is, so projects move between Space Bench, Wokwi
and Velxio. If Velxio code is ever copied in, Space Bench has to be released under the
AGPL-3.0.

---

## Phase 1 — Arduino AVR workspace ☑ done 2026-10-11

### 1.1 ☑ Emulator core (`src/mcu/`)
- `avr.ts`: avr8js CPU, GPIO ports, timers 0–5, USART, ADC, TWI, SPI, EEPROM and
  watchdog. The Mega's interrupt vectors and timers 3/4/5 come from the ATmega2560
  datasheet. Every pin change is time-stamped in CPU cycles, which gives PWM duty, pulse
  width (servo) and period (tone).
- `boards.ts`: pin maps for the Uno, Nano and Mega 2560 (from the Arduino core's
  `pins_arduino.h`), FQBN, flash and SRAM, and Wokwi pin aliases.
- `circuit.ts`: wires → nets (union-find, Wokwi's `GND.1 = GND.2` rule) → DC nodal solve.
  - Output pins are 5 V / 0 V behind 25 Ω; pull-ups are 37 kΩ.
  - LEDs are diodes (Vf by colour + Rs), solved with on/off iteration.
  - Pots, switches and resistors are resistances.
  - **Electrical warnings:** an LED over 30 mA (suggests a resistor value), a pin over 40 mA, a shorted supply.
- `sim.ts`: re-solves on every pin change (cached by state signature) and pushes input
  levels and ADC voltages back into the chip. LED current is integrated over time, so
  PWM and multiplexing give the right brightness.
- `devices.ts`:
  - HD44780 LCD, parallel 4/8-bit or behind the PCF8574 I²C backpack;
  - SSD1306 OLED;
  - an I²C bus that routes by address;
  - WS2812 bit-stream decoding from pin timing.
- Protocol devices in `sim.ts`, driven by clock events:
  - **HC-SR04:** TRIG pulse → ECHO pulse of 58 µs per cm;
  - **DHT22:** the full one-wire handshake and 40 bits with checksum.
- Sensor modules: NTC (β 3950 divider), photoresistor (Wokwi's lux curve), joystick, PIR, tilt.
- `sim.worker.ts`: runs in a Web Worker in real time (or reports the speed it reaches); the
  UI gets about 60 frames a second.

### 1.2 ☑ Compiler
- Rust `src-tauri/src/arduino.rs`: commands `arduino_compile`, `arduino_status` and
  `arduino_install_core`.
  - Finds arduino-cli (Settings path, PATH, Homebrew, login shell).
  - Uses one sketch and build folder per board, so incremental builds are fast.
  - Installs the libraries named in `libraries.txt`.
- The browser preview uses the same steps through the dev server (`vite-arduino.ts`).
- `compile.ts` parses gcc errors into Monaco markers, the Problems list and flash/RAM use.

### 1.3 ☑ Workspace UI (`McuWorkspace.tsx`)
- **Header:** project name, board picker, Compile (⌘B), Run / Pause / Restart / Stop (⌘↵),
  speed (0.1×–2×), Save (⌘S), import/export, AI (⌘J).
- **Left:** workspace files, i.e. `sketch.ino`, extra `.h`/`.cpp`/`.ino` files (new,
  rename, delete), `libraries.txt` and `diagram.json` (editable as JSON); Add Part.
- **Editor:** Monaco, bundled locally, with C++ highlighting, Arduino API completions, one
  model per file and compiler markers.
- **Canvas** (`McuCanvas.tsx`):
  - Wokwi elements with pan and zoom; drag to move; click a pin, then another, to wire.
  - Wires are coloured automatically by pin; Wokwi route hints are honoured, otherwise
    wires leave the header in separate lanes.
  - A toolbar for the selected part: rotate, duplicate, settings, delete. Undo/redo.
  - Live pin voltages on hover; a status badge (chip, nets, simulated time, speed).
  - Electrical warnings; sliders for sensors while running.
- **While running:** LEDs, RGB LEDs, bar graphs and 7-segment displays glow; servos turn;
  LCDs and OLEDs draw; NeoPixels change colour; buzzers play through the speakers;
  buttons, pots, switches and the joystick drive the sketch; the board's reset button
  restarts it.
- **Bottom:** Serial Monitor (send with Newline / CR+LF / none), Output (arduino-cli),
  Problems.
- **Add Part:** (superseded by 3.2's Add Component dialog) a searchable catalogue of 25 parts with live thumbnails. Part settings:
  id (rename keeps the wires), typed attributes, free-form attributes.

### 1.4 ☑ Projects, Start screen, AI
- In a project, `firmware/<name>/` holds the sketch, `diagram.json` and `libraries.txt`.
  It shows in the Project tree and has a "New Arduino sketch" item. Sketches saved without
  a project go to `~/Documents/Space Bench/Sketches/`.
- Start screen → **Microcontrollers**:
  - new Uno, Nano or Mega sketch;
  - compiler status, with a one-click install of the AVR core;
  - My Sketches;
  - 17 examples with diagram previews.
  - Home has a "New Arduino sketch" card (⌘⇧A).
- Settings → **Microcontrollers**: arduino-cli path, cores, emulator speed, buzzer sound.
- **AI assistant** (`mcu/agent.ts`, via the new `AgentProfile` in `lib/ai/agent.ts`):
  - tools `get_project`, `write_file`, `set_diagram`, `compile`, `run` (returns Serial
    output, warnings, LED, servo, tone and LCD readouts), `stop` and `set_input`;
  - the prompt teaches the diagram.json format, pins, wiring rules and library names.

**Verified**
- `src/mcu/sim.test.ts` and `examples.test.ts` (22 tests): every example is compiled by
  arduino-cli and run on the emulator, with behaviour checked:
  - Blink and its Serial output;
  - button with pull-up; pot → ADC → PWM dimming;
  - traffic light; RGB LED; melody frequencies; servo angle;
  - I²C and parallel LCD text; OLED pixels; the 7-segment digit "0";
  - NTC 24 °C; HC-SR04 100 cm; DHT22 40 % / 24 °C; NeoPixel colour;
  - Serial echo with input; the missing-resistor warning.
- `project.test.ts`: the sketch folder round trip.
- In the browser:
  - Blink runs at 100 % real time;
  - the I²C LCD shows its text;
  - the button lights its LED;
  - Add Part and wiring with real clicks;
  - a compile error is underlined in Monaco and listed in Problems;
  - Save, then reopen from My Sketches.

---

## Phase 2 — More boards ◐ (2026-10-11)
- **2.1 ☑ Raspberry Pi Pico (RP2040)** — `src/mcu/rp2040.ts` on rp2040js (MIT).
  - arduino-pico's flash image (`rp2040:rp2040:rpipico`, core installed from the Microcontrollers page) boots through the real B1 boot ROM (from rp2040js's demo; Raspberry Pi, BSD-3).
  - `Serial` is USB CDC (rp2040js's USB host enumerates it); `Serial1` is UART0. Both go to the Serial Monitor.
  - GPIO with pull-up / pull-down, ADC (GP26–28, 12-bit against 3.3 V), PWM and I²C0 (GP4/GP5).
  - PIO with real timing: rp2040js runs one PIO instruction per step and ignores delays and the clock divider, so `rp2040.ts` steps every state machine on the system clock (delay + 1) × divider.
  - Board drawing `elements/pi-pico.ts` (our own; Wokwi's pin names). The circuit runs at 3.3 V, and pins warn above 12 mA.
  - Verified (`pico.test.ts`): Blink + USB serial, button, ADC + PWM, I²C LCD, NeoPixel through PIO. In the browser it runs at 100 % real time.
- **2.2 ☑ ATtiny85** (branch `more-boards`, 2026-10-11) — avr8js with an ATtiny85 profile in `avr.ts`.
  - ATTinyCore (`ATTinyCore:avr:attinyx5:chip=85,clock=8internal`, 8 MHz). Port B with pin-change and INT0, Timer0 (its own register layout) and avr8js's `ATtinyTimer1`, the 4-channel ADC (ADC0–3 = PB5, PB2, PB4, PB3), watchdog, 512 B EEPROM, one-word vectors.
  - No USART / TWI / SPI: ATTinyCore's `Serial` is bit-banged TX on PB0, decoded from its edges (the baud is found from the shortest run).
  - In the canvas (catalogue entry) and in schematics (KiCad `MCU_Microchip_ATtiny:ATtiny85*`). Verified (`attiny.test.ts`): `millis()` timing, ADC 512 at 2.5 V, Serial, a bare ATtiny85 blinking an LED on ngspice.
- **2.3 ☑ ESP32** on Espressif's QEMU (`qemu-system-xtensa`, found in PATH or `~/.espressif/tools`, or installed from Settings → Microcontrollers into `~/Library/Application Support/Space Bench`).
  - Espressif's QEMU doesn't model GPIO levels. A **bridge** (`esp32/bridge.ts`, a C++ file added to the sketch when it runs in the emulator) overrides the core's weak `pinMode` / `digitalWrite` / `digitalRead` / `analogRead`. It wraps ESP-IDF's LEDC calls (`--wrap=ledc_channel_config,ledc_timer_config,ledc_set_duty`), so PWM is reported per pin.
  - Pin activity goes out over **UART2** as 5-byte frames; input levels and ADC voltages come back the same way.
  - QEMU's ADC model panics at set-up, so `analogRead` reads the circuit's voltage from Space Bench.
  - `src-tauri/src/esp32.rs` runs the session: UART0 is stdin/stdout, UART2 a local TCP socket, and the UI polls it 30×/s. `esp32/machine.ts` turns the frames into pin activity for the circuit, with 1 kHz edges for PWM duty.
  - Built with `FlashMode=dio` (QIO panics in QEMU).
  - Verified (`esp32.test.ts`): Blink, button → `digitalRead`, pot → `analogRead` ≈ 2400, PWM dimming. In the browser: 100 % real time.
  - Not yet: I²C / SPI devices on the ESP32 (no bus bridge), interrupts on input changes, Wi-Fi.
  - **ESP32-S3 DevKitC-1 and ESP32-C3 DevKitM-1** (2026-10-11): `-M esp32s3` (xtensa) and `-M esp32c3 -icount 3` (`qemu-system-riscv32`, installed with the xtensa build). QEMU wires only UART0/UART1 on these, so the bridge (chosen by `CONFIG_IDF_TARGET_*`) uses UART1 at 0x60010000 with 10-bit FIFO counters. Verified (`esp32-variants.test.ts`): Serial, pin writes, `analogRead` ≈ 2047 at 1.65 V. Canvas only (ESP32s aren't in schematics yet).
- **2.4 ☑ Raspberry Pi 5 / 4B / 3B+ / Zero 2 W — Linux** (branch `more-boards`, 2026-10-11; `src/linux/`, `linux-guest/`).
  - No emulator models the Pi 5's hardware (RP1), so the Pis are a QEMU `virt` VM on the host hypervisor (HVF): Debian 13 arm64 — the base of Raspberry Pi OS — plus Raspberry Pi's own archive (gpiozero 2, lgpio, rpi-lgpio = RPi.GPIO for Pi 5). Boots in ~3 s.
  - The VM identifies as the chosen Pi: `spacebench-identity` rewrites the device tree's model / compatible / `system/linux,revision` at boot (credential `spacebench.board` on the kernel command line), so gpiozero reports e.g. "5B · BCM2712".
  - GPIO: Debian's kernel lacks `gpio-sim`, so the setup builds it (plus `irq_sim`) from the kernel.org sources of the guest's kernel; a 28-line `pinctrl-rp1` chip (GPIO0–27). The agent (`spacebench-agent`, virtio-serial) reports pin changes with guest timestamps and sets input levels through the simulated pulls (re-applied when a program sets a line's bias).
  - Lockstep: the agent times each frame by the guest clock; the VM is paused (QMP `stop`, its clock too) while ngspice simulates. ~70 % of real time in tests.
  - One-time setup (Settings → Microcontrollers → Linux Boards, `provision.ts` + `provision.sh`): ≈ 1 GB, ~3 min. Direct kernel boot afterwards; the agent updates itself from the app.
  - Schematics: KiCad `Connector:Raspberry_Pi_4` (Value "Pi 5" → Pi 5) and `Raspberry_Pi_2_3` (Value "Zero 2" → Zero 2 W). Canvas: catalogue boards. `main.py` runs as the pi user; the Firmware panel has a Terminal on the console.
  - Verified (`linux.test.ts`): gpiozero LED + Button through ngspice, the example's `when_pressed` callback, the canvas solver.
  - Not yet: I²C / SPI / UART devices on the header, hardware PWM, the desktop (GUI), several Pis at once.
- **2.4b ☑ Renode boards: STM32F4 Discovery, STM32 Blue Pill, Arduino Nano 33 BLE** (`src/renode/`, `renode/sb_renode.py`).
  - Antmicro's Renode (MIT, portable macOS build installed from Settings) runs the real ELF; Space Bench drives its monitor. The helper hooks every GPIO line (virtual timestamps), reads pin modes / pulls from the registers (STM32F4, STM32F1, nRF52 layouts), captures the UART and runs exact `RunFor` steps. The SysTick follows `SystemCoreClock`.
  - Blue Pill builds get a `SystemClock_Config` that stays on the 8 MHz HSI (the F1 model has no clock tree). Bare `STM32F407V*` / `STM32F103C8` KiCad symbols are programmable parts.
  - Verified (`renode.test.ts`): a bare STM32F407 blinking an LED and reading a pulled-up input on ngspice; the canvas solver.
  - Tried and not working yet: STM32 Black Pill (F401/F411 builds hang Renode's F4 model), Arduino Uno R4 Minima (the core's USB set-up never finishes on Renode's RA4M1). No ADC on these platforms yet.
- **2.5 ☐ Pico W Wi-Fi** — assessed, not built.
  - The CYW43439 radio is driven over PIO-gSPI with a binary WLAN firmware blob. Emulating it means implementing the chip's SPI protocol, its firmware boot handshake and an 802.11 / Ethernet bridge to the host (picowi documents the driver side).
  - That is a project of its own; plain Pico sketches run today.

## Phase 3 — Parts and circuits ◐
- **3.1 ☑ Breadboard** — `elements/breadboard.ts`: half, full and mini, with Wokwi's hole names (`12t.a`…, `tp.n`/`tn.n`/`bp.n`/`bn.n`).
  - Strips and rails are nets through the shared-prefix rule.
  - **Seating:** a part pin on a hole connects to it (`McuCanvas` → `onSeated` → the workspace's `simDiagram`). Dropping a part snaps its nearest pin onto a hole, and moving the breadboard carries the parts plugged into it.
  - Example "Breadboard LED"; test in `examples.test.ts`.
- **3.2 ☑ Parts catalogue (2026-10-11)** — every part in Velxio's Add Component list, rebuilt from scratch (no Velxio code or data; names and pinouts are the makers' product facts). Code: `src/mcu/catalog/`.
  - **Size:** 472 entries (71 boards, 138 sensors, 42 outputs, 41 displays, 33 inputs, 15 motors, 20 comms, 34 analog, 25 logic, passives …); 354 are simulated.
  - **Files:** `data.ts` holds names, groups/sub-groups, pins and a behaviour model; descriptions are generated from the model.
  - **Drawings:** `look.ts` draws them as `sb-*` custom elements (Grove twig, breakout, dev board, DIP, TO-92/220, two-lead parts, gate, flip-flop, meter, screen, strip/ring, relay). Pins sit on the 2.54 mm grid and a `state` paints what the simulation shows.
  - **Solver** (`elements.ts`): R/C/L, diodes and zeners, batteries, bench supply, regulators (78xx/79xx/LM317), NPN/PNP, N/P-MOSFETs, op-amps (VCVS with rail clamping), optocouplers, gates, 74HC00/02/04/08/14/32/86, D/JK/T flip-flops (clock edges between solves), relays (module/bare coil/SSR, I²C relay boards), L293D, meters.
  - **Devices** (`devices.ts`): analog/digital modules from sliders and clicks, buttons, active/passive buzzers, motors, signal generator, 1-Wire (DS18B20, MAX31850 — search included), DHT11/22, MAX6675, HX711, TM1637, MY9221, P9813, WS2813 strips/rings, GPS NMEA and MH-Z16 over UART (SoftwareSerial or hardware RX), 125 kHz RFID, NEC IR remote → receivers, encoders, keypad, joystick, ADXL335, pulse/ECG/dust sensors, Grove ultrasonic, rotary dialer, servo, A4988 + steppers, gear motor encoder, MCP3008.
  - **I²C** (`i2c.ts`): BME280/BMP280/BME680/688 (Bosch compensation inverted by search), SHT3x/4x, AHT20/DHT20, TH02, SCD30/SCD4x, SGP30/41, SFA30, SEN5x, HM3301, multichannel gas, D7S, MPU6050/9250, ICM20600, LSM6DS3, ADXL345, LIS3DH, MMA7660, BMA400, AS5600, ADS1115, MCP9808, MCP9600, TSL2561, VEML6040, MLX90614/5, VL53L0X (permissive), MPR121, PAJ7620, DS1307/DS3231/PCF85063, HT16K33 (matrix + alphanumeric), SH1107, SSD1306-class OLEDs, Grove LCD (+RGB backlight), PCA9685, TCA9548A, EEPROM.
  - **Boards** that run on the existing emulators: Pico W and XIAO RP2040 (RP2040); DevKitC V4, ESP32-CAM, Lolin32 Lite (ESP32/QEMU); DFRduino Uno/Nano/Mega, Romeo BLE, Romeo BLE mini, Beetle BLE (AVR). `BoardDef.variantOf` keeps them off the start page.
  - **UI:** new Add Component dialog (category tree with counts, search, "Simulated only", lazy thumbnails, "Drawing only"/"No emulator" badges). Live sliders for every catalogue control. Clicks, presses and element events (keypad, encoder, IR remote, dialer). Example "Grove starter kit".
  - **Drawing only (not simulated yet):** Linux Pis, STM32/nRF/SAMD/RA4M1/ESP32-S3/C3/C6/P4 boards, ATtiny85, e-paper, SPI TFTs, cameras, radios, voice/AI modules, MAX31856/65, DPS310, BMM150, BMI088, BMA456, MLX9064x.
  - **Tests:** `catalog/*.test.ts` — solver parts, 21 sketches against the real libraries (Adafruit, RTClib, DallasTemperature, TM1637, TinyGPSPlus, HX711, rgb_lcd …, installed into a scratch sketchbook via `SB_ARDUINO_USER`), and board variants.
  - In a default shell `vitest run src/mcu` gives 62 passed + 19 skipped: the skips are the library tests in `catalog/devices.test.ts`. Its header has the one-time install command (libraries go into a scratch folder, not ~/Documents/Arduino); with `SB_ARDUINO_USER` set all 81 pass.
- **3.3 ☑ Fritzing parts** — `fritzing.ts`: a `.fzpz` (zip: `.fzp` + SVGs) → a part.
  - The breadboard SVG is its drawing. Pin positions come from each connector's SVG element, with the full `transform` chain applied and units converted (mm / in / px).
  - `<bus>` members get one name prefix, so they are one net.
  - Stored in `~/Documents/Space Bench/Parts/` and loaded at start-up into Parts → Imported. Import and remove from Start → Microcontrollers → Imported Parts.
  - Imported parts are passive: they connect, they don't act.
  - Verified against fritzing-parts' US-100 (CC-BY-SA; fixture in `src/mcu/__fixtures__`) and in the browser.
- **3.4 ☑ Check with ngspice** — `spice.ts` + `CheckDialog.tsx`.
  - Takes the running circuit at that instant: pin levels (sources behind 25 Ω), pull-ups, sensor outputs, buttons and pots.
  - Writes a SPICE deck with LED diode models (Vf by colour) and runs an operating point on the app's ngspice.
  - Shows every part's current, voltage and power and flags LEDs over 20 mA, pins over their limit and resistors over ¼ W. Net voltages and the deck are shown too.
  - Verified (`spice.test.ts`: 220 Ω + red LED on a HIGH pin → 10–14 mA) and in the browser.
- **3.5 ☑ Logic analyser** — the simulator records every level change of every wired board pin with its simulated time (`sim.ts` → `Frame.logic`). `logic.ts` keeps a rolling capture and measures frequency and duty.
  - **Logic Analyser** tab: window from 100 µs to 5 s, Hold, cursor readout, show/hide channels, and **VCD** export (GTKWave, PulseView).
  - Verified (`logic.test.ts`), and in the browser: Uno pin 9 PWM = 490 Hz.
  - The oscilloscope (analog) is still to do.

## Phase 4 — Workflow ◐
- **4.1 ◐ More examples** — 10 offline "IoT Projects":
  - night light, parking sensor, PIR alarm, thermostat with LCD, DHT22 weather station on OLED, joystick servo, press counter, reaction timer, plant monitor, electronic dice;
  - each is compiled and checked in `examples.test.ts`.
  - The project ideas follow the "100 Days 100 IoT Projects" topics. Its code is unlicensed MicroPython, so nothing was copied; the sketches are our own Arduino code.
  - Wi-Fi / cloud projects need networking (see 2.3 / 2.5).
- **4.1b ☑ Several boards per sketch** (built in a parallel session; `src/mcu/multiboard.ts`).
  - The first board keeps the top-level files; other boards' files live in `<id>/…` folders.
  - One simulation worker per board on `boardDiagram()` (its own parts plus the shared GND); the frames are merged for the canvas.
  - Clicking a board, its canvas "Code" button or its sidebar header shows that board's code. Serial and Output have a chip per board, and Compile builds every board in turn. The board type is changed in Part Settings.
  - Not yet: wires between two boards' signal pins (a canvas note says so), and more than one ESP32 at a time (QEMU is one session).
  - Tests: `multiboard.test.ts`.
- **4.2 Library manager:** search the Arduino index from the UI (`arduino-cli lib search`)
  instead of editing libraries.txt by hand.
- **4.3 Debugging:** pause on a line (avr-gdb protocol to avr8js), watch variables from the
  ELF symbols, step.
- **4.4 Upload to real hardware:** `arduino-cli upload` to a connected board (desktop app).
- **4.5 Wokwi project import:** a `.zip` or wokwi.toml folder, as well as pasted
  diagram.json.
- **4.6 Bundle arduino-cli** (and the AVR core) with the installer, like plan-02 step 2.1
  for ngspice, so the workspace works with nothing installed.
