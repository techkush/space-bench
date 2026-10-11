// The AI assistant in the microcontroller workspace: it writes the sketch and the wiring
// diagram, compiles with arduino-cli, runs the emulator, reads the Serial Monitor and
// presses buttons / turns knobs — then fixes what it sees.
import type { AgentProfile } from "@/lib/ai/agent"
import type { ToolDef } from "@/lib/ai/claude"
import { BOARDS } from "./boards"
import { parseDiagram } from "./diagram"
import { PARTS } from "./parts"

export interface McuAgentHost {
  project(): { name: string; board: string; files: { name: string; content: string }[]; diagram: string; lastCompile: string; serial: string }
  writeFile(name: string, content: string): string
  setDiagram(text: string): string
  compile(): Promise<{ ok: boolean; text: string }>
  run(seconds: number): Promise<string>
  stop(): string
  setInput(part: string, value: string): string
}

const PINS: Record<string, string> = {
  "wokwi-led": "A (anode, +), C (cathode, −)",
  "wokwi-rgb-led": "R, G, B, COM",
  "wokwi-resistor": "1, 2",
  "wokwi-pushbutton": "1.l, 1.r (same contact), 2.l, 2.r (same contact) — pressing joins 1 and 2",
  "wokwi-slide-switch": "1, 2 (common), 3",
  "wokwi-potentiometer": "GND, SIG, VCC",
  "wokwi-slide-potentiometer": "VCC, SIG, GND",
  "wokwi-buzzer": "1 (−), 2 (+)",
  "wokwi-servo": "GND, V+, PWM",
  "wokwi-led-bar-graph": "A1…A10 (anodes), C1…C10 (cathodes)",
  "wokwi-neopixel": "VDD, VSS, DIN, DOUT",
  "wokwi-analog-joystick": "VCC, VERT, HORZ, SEL, GND",
  "wokwi-dip-switch-8": "1a…8a, 1b…8b",
  "wokwi-ntc-temperature-sensor": "GND, VCC, OUT (analog)",
  "wokwi-photoresistor-sensor": "VCC, GND, DO (digital), AO (analog)",
  "wokwi-pir-motion-sensor": "VCC, OUT, GND",
  "wokwi-tilt-switch": "GND, VCC, OUT",
  "wokwi-hc-sr04": "VCC, TRIG, ECHO, GND",
  "wokwi-dht22": "VCC, SDA (data), NC, GND",
  "wokwi-lcd1602": "attrs.pins \"i2c\": GND, VCC, SDA, SCL (address 0x27) · attrs.pins \"full\": VSS, VDD, V0, RS, RW, E, D0…D7, A, K",
  "wokwi-lcd2004": "same as lcd1602",
  "wokwi-ssd1306": "GND, VIN, DATA (SDA), CLK (SCL), DC, RST, CS, 3V3 — I²C at 0x3C",
  "wokwi-7segment": "A…G, DP, COM.1/COM.2 (1 digit) or DIG1…DIG4 (attrs.digits); attrs.common cathode|anode",
}

const TOOLS: ToolDef[] = [
  { name: "get_project", description: "The sketch files, libraries.txt, the wiring diagram (diagram.json), the board, the last compile result and the Serial Monitor's last output.", input_schema: { type: "object", properties: {} } },
  { name: "write_file", description: "Create or replace a sketch file: sketch.ino, extra .h / .cpp / .ino files, or libraries.txt (one Arduino library per line, e.g. \"Servo\", \"LiquidCrystal I2C\", \"Adafruit NeoPixel\").", input_schema: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] } },
  { name: "set_diagram", description: "Replace the wiring diagram with a complete diagram.json (Wokwi format). The canvas redraws. Returns problems (unknown parts or pins) to fix.", input_schema: { type: "object", properties: { diagram: { type: "string", description: "diagram.json text" } }, required: ["diagram"] } },
  { name: "compile", description: "Compile the sketch with arduino-cli. Returns the errors (fix them and compile again) or the flash / RAM used.", input_schema: { type: "object", properties: {} } },
  { name: "run", description: "Compile if needed and run the emulator for a few seconds of real time; returns the Serial output, electrical warnings (missing resistors, overloaded pins) and what the outputs did (LEDs, servo angles, buzzer tones, LCD text).", input_schema: { type: "object", properties: { seconds: { type: "number", description: "1–10, default 3" } } } },
  { name: "stop", description: "Stop the emulator.", input_schema: { type: "object", properties: {} } },
  { name: "set_input", description: "While running: press / release a button (\"press\" / \"release\"), turn a potentiometer (0–1023 or \"50%\"), flip a slide switch (0/1), set a sensor (NTC °C, LDR lux, HC-SR04 cm, DHT22 °C), trigger a PIR (\"on\"/\"off\"). Catalogue sensors take their slider values as \"t=30, h=60\" (or a bare number for the first slider); Grove buttons \"press\"/\"release\".", input_schema: { type: "object", properties: { part: { type: "string", description: "part id, e.g. btn1, pot1" }, value: { type: "string" } }, required: ["part", "value"] } },
]

const LABELS: Record<string, string> = { get_project: "Read the project", write_file: "Wrote a file", set_diagram: "Wired the diagram", compile: "Compiled", run: "Ran the sketch", stop: "Stopped", set_input: "Input" }

function system(): string {
  const boards = BOARDS.filter((b) => !b.variantOf).map((b) => `- ${b.type} (${b.name}, FQBN ${b.fqbn}): pins ${Object.keys(b.pins).slice(0, 8).join(", ")}… plus 5V, 3.3V, VIN, GND.1/GND.2/GND.3`).join("\n")
  const parts = PARTS.filter((p) => p.category !== "Boards" && !p.cat).map((p) => `- ${p.type} — ${p.title}: pins ${PINS[p.type] ?? "see pinInfo"}${p.attrs ? `; attrs ${JSON.stringify(p.attrs)}` : ""}`).join("\n")
    + "\n" + PARTS.filter((p) => p.cat && p.sim && !p.cat.board && !p.key?.includes("#")).map((p) => `- ${p.type} — ${p.title}: pins ${p.cat!.pins.join(", ")}${p.cat!.model.m === "i2c" ? ` (I²C 0x${p.cat!.model.addr.toString(16)})` : ""}`).join("\n")
  return `You are the microcontroller assistant in Space Bench, a free, open-source desktop app for electronics. The user's project is an Arduino sketch plus a wiring diagram on a canvas, emulated in real time (avr8js — the real compiled firmware runs on an emulated ATmega328P/2560) with an electrical solver around the chip (LED currents, pull-ups, voltage dividers).

Work like an engineer: read the project (get_project), write the sketch (write_file), wire the diagram (set_diagram), compile, run it, read the Serial output and the warnings, and fix problems until it works. Keep explanations short.

## diagram.json (Wokwi format)
{ "version": 1, "author": "", "editor": "spacebench",
  "parts": [ { "type": "wokwi-arduino-uno", "id": "uno", "top": 0, "left": 0, "attrs": {} },
             { "type": "wokwi-led", "id": "led1", "top": -120, "left": 120, "attrs": { "color": "red" } } ],
  "connections": [ [ "uno:13", "r1:2", "green", [] ], [ "r1:1", "led1:A", "green", [] ], [ "led1:C", "uno:GND.1", "black", [] ] ] }
- Each connection is [ "part:pin", "part:pin", colour, [] ]. Colours: green, red (supply), black (ground), blue, orange, yellow, purple.
- Coordinates are pixels; the Uno is about 274 × 202 with its digital header along the top (y ≈ 9) and power/analog along the bottom (y ≈ 192). Put parts above or below the header they connect to, 40–60 px apart, so wires stay short.
- Every LED needs a series resistor (220–330 Ω); buttons use INPUT_PULLUP and connect to GND; I²C on the Uno is A4 (SDA) / A5 (SCL), on the Mega 20/21.
- rotate: 90 / 180 / 270 turns a part.

## Boards
${boards}

## Parts
${parts}

## Libraries
List every library the sketch #includes (except Wire, SPI, EEPROM, SoftwareSerial — built in) in libraries.txt, one per line, with the Arduino Library Manager name: Servo, LiquidCrystal, LiquidCrystal I2C, Adafruit SSD1306, Adafruit GFX Library, Adafruit NeoPixel, DHT sensor library, Adafruit Unified Sensor.
`
}

export function mcuProfile(host: McuAgentHost): AgentProfile {
  return {
    system,
    tools: TOOLS,
    labels: LABELS,
    intro: "Describe a project — “a thermometer that shows °C on an LCD”, “a servo controlled by a knob” — or ask about the sketch. The assistant writes the code, wires the parts, compiles, runs it and checks the Serial output.",
    suggestions: [
      "Make a traffic light with a pedestrian button",
      "Show the temperature from an NTC sensor on a 16×2 I²C LCD",
      "Control a servo with a potentiometer and print the angle",
      "Why doesn't my sketch compile?",
    ],
    placeholder: "Ask for a sketch, wiring, or a fix…",
    summarize: (name, input, result, ok) => {
      if (!ok) return result.split("\n")[0].slice(0, 160)
      if (name === "write_file") return String(input.name)
      return result.split("\n")[0].slice(0, 140)
    },
    async run(name, input) {
      switch (name) {
        case "get_project": {
          const p = host.project()
          return { ok: true, result: `Project: ${p.name}\nBoard: ${p.board}\n\n${p.files.map((f) => `--- ${f.name}\n${f.content}`).join("\n\n")}\n\n--- diagram.json\n${p.diagram}\n\nLast compile: ${p.lastCompile || "not compiled yet"}\n\nSerial (last output):\n${p.serial.slice(-1500) || "(nothing)"}` }
        }
        case "write_file": { const r = host.writeFile(String(input.name ?? ""), String(input.content ?? "")); return { ok: !r.startsWith("Not"), result: r } }
        case "set_diagram": {
          try { parseDiagram(String(input.diagram ?? "")) } catch (e) { return { ok: false, result: `Not valid diagram.json: ${e instanceof Error ? e.message : e}` } }
          const r = host.setDiagram(String(input.diagram))
          return { ok: !/^(Not|Problems)/.test(r), result: r }
        }
        case "compile": { const r = await host.compile(); return { ok: r.ok, result: r.text } }
        case "run": { const r = await host.run(Math.max(1, Math.min(10, Number(input.seconds ?? 3)))); return { ok: !/^(Not|Compile failed)/.test(r), result: r } }
        case "stop": return { ok: true, result: host.stop() }
        case "set_input": { const r = host.setInput(String(input.part ?? ""), String(input.value ?? "")); return { ok: !/^(No |Not)/.test(r), result: r } }
        default: return { ok: false, result: `Unknown tool ${name}` }
      }
    },
  }
}
