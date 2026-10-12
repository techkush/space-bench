// The chip side of a co-simulation: a board's real firmware on the emulator, run one frame at a
// time. Each frame starts with the levels and voltages the circuit put on its input pins, and
// reports every pin change with its time, so the circuit can be simulated over the same frame.
import { AvrMachine } from "@/mcu/avr"
import type { BoardDef } from "@/mcu/boards"
import type { Machine } from "@/mcu/machine"
import { Rp2040Machine } from "@/mcu/rp2040"
import type { ModView } from "@/mcu/catalog/look"
import type { Diagram } from "@/mcu/diagram"
import { McuSim, type Frame } from "@/mcu/sim"

/** Arduino modules that run with the chip (cosim/modules.ts): the diagram, and the chip pins they own. */
export interface ChipModules { diagram: Diagram; owned: string[] }
/** A module's live state from the schematic: sliders, pressed / active. */
export interface ModuleUi { v?: Record<string, number>; pressed?: boolean; active?: boolean }

/** What a pin is doing: drives low/high (0/1) or is an input (-1), and its pull resistors. */
export interface PinState { out: 0 | 1 | -1; pu: boolean; pd: boolean }
/** A pin change, `t` seconds after the frame started. */
export interface PinEvent extends PinState { pin: string; t: number }

export interface FrameIn {
  /** simulated seconds to run */
  seconds: number
  /** input pins: the level the circuit puts on them */
  digital: [string, boolean][]
  /** ADC channels: volts */
  analog: [number, number][]
}
export interface FrameOut {
  /** every pin's state when the frame started */
  start: [string, PinState][]
  events: PinEvent[]
  serial: string
  /** the chip's clock after the frame */
  seconds: number
  /** what the modules running with the chip show (by part ref): screens, LEDs, text */
  mods?: Record<string, ModView>
}

/** Talks to a chip, in a worker (the app) or in-process (tests). */
export interface ChipLink {
  frame(f: FrameIn): Promise<FrameOut>
  serialWrite(text: string): void
  dispose(): void
  /** a part's control changed (Linux boards: the camera / microphone feeders; modules: their sliders) */
  ui?(part: string, u: ModuleUi): void
}

export class ChipRunner {
  readonly machine: Machine
  private readonly pins: string[]
  private events: PinEvent[] = []
  private serial = ""
  private t0 = 0

  /** the Microcontrollers simulator around the chip, when modules run with it */
  private sim: McuSim | null = null
  private owned = new Set<string>()

  constructor(board: BoardDef, firmware: string | Uint8Array, modules?: ChipModules) {
    if (modules && modules.diagram.parts.length > 1 && (board.chip === "rp2040" || board.chip === "atmega328p" || board.chip === "atmega2560")) {
      // the catalogue models talk to the chip through McuSim (its buses, pins and timers)
      this.sim = new McuSim(modules.diagram, firmware)
      this.machine = this.sim.machine
      this.owned = new Set(modules.owned)
      this.pins = Object.keys(board.pins)
      this.sim.onSerial = (s) => { this.serial += s }
      const inner = this.machine.onPinChange
      this.machine.onPinChange = (pins) => {
        inner?.(pins)
        const t = (this.machine.now - this.t0) / this.machine.hz
        for (const pin of pins) this.events.push({ pin, t, ...this.state(pin) })
      }
      return
    }
    if (board.chip === "rp2040") {
      if (typeof firmware === "string") throw new Error("The Pico needs a .bin flash image")
      this.machine = new Rp2040Machine(board, firmware)
    } else if (board.chip === "atmega328p" || board.chip === "atmega2560" || board.chip === "attiny85") {
      if (typeof firmware !== "string") throw new Error("AVR boards need an Intel HEX file")
      this.machine = new AvrMachine(board, firmware)
    } else throw new Error(`${board.name} can't run inside a schematic yet`)
    this.pins = Object.keys(board.pins)
    this.machine.onSerial = (s) => { this.serial += s }
    this.machine.onPinChange = (pins) => {
      const t = (this.machine.now - this.t0) / this.machine.hz
      for (const pin of pins) this.events.push({ pin, t, ...this.state(pin) })
    }
  }

  private state(pin: string): PinState {
    const tr = this.machine.track.get(pin)
    return { out: tr?.out === true ? 1 : tr?.out === false ? 0 : -1, pu: !!tr?.pullup, pd: !!tr?.pulldown }
  }

  frame(f: FrameIn): FrameOut {
    // pins a module is wired to are set by the module (inside the chip's simulator), not the circuit
    for (const [pin, high] of f.digital) if (!this.owned.has(pin)) this.machine.setInput(pin, high)
    for (const [ch, v] of f.analog) this.machine.setAnalog(ch, v)
    this.t0 = this.machine.now
    const start = this.pins.map((p): [string, PinState] => [p, this.state(p)])
    this.events = []
    let mods: Record<string, ModView> | undefined
    if (this.sim) mods = viewsOf(this.sim.step(f.seconds * 1000, f.seconds * 1000))
    else this.machine.runFor(Math.round(f.seconds * this.machine.hz))
    const out: FrameOut = { start, events: this.events, serial: this.serial, seconds: this.machine.seconds, ...(mods ? { mods } : {}) }
    this.events = []
    this.serial = ""
    return out
  }

  serialWrite(text: string) { this.machine.serialWrite(text) }

  /** a module's sliders / press changed in the schematic */
  ui(part: string, u: ModuleUi) {
    if (!this.sim) return
    this.sim.setUi(part, { ...(u.v ? { v: u.v } : {}), ...(u.pressed !== undefined ? { pressed: u.pressed } : {}), ...(u.active !== undefined ? { active: u.active } : {}) })
  }
}

/** Everything the modules show, as ModViews by part: their own views, LCD text, OLED pixels, LED strips. */
function viewsOf(f: Frame): Record<string, ModView> {
  const out: Record<string, ModView> = {}
  for (const [id, v] of f.mods) out[id] = { ...v }
  for (const [id, l] of f.lcd) {
    const rows = l.chars.length > 32 ? 4 : 2, cols = l.chars.length / rows
    const text = Array.from({ length: rows }, (_, r) => String.fromCharCode(...l.chars.slice(r * cols, (r + 1) * cols)).replace(/[^\x20-\x7e]/g, " ").trimEnd()).join("\n")
    out[id] = { ...out[id], text, glow: [l.backlight ? 1 : 0] }
  }
  for (const [id, o] of f.oled) {
    // SSD1306 RAM is 8 pages of 128 columns (a byte = 8 vertical pixels): to 1-bpp rows
    const data = new Uint8Array(16 * 64)
    if (o.on) for (let page = 0; page < 8; page++) for (let x = 0; x < 128; x++) {
      const b = o.ram[page * 128 + x]
      for (let bit = 0; bit < 8; bit++) if (((b >> bit) & 1) !== (o.invert ? 1 : 0)) { const y = page * 8 + bit; data[y * 16 + (x >> 3)] |= 0x80 >> (x & 7) }
    }
    out[id] = { ...out[id], bitmap: { w: 128, h: 64, data } }
  }
  for (const [id, px] of f.neopixel) out[id] = { ...out[id], pix: px }
  return out
}

/** The chip on this thread (tests, or when workers aren't available). */
export function localChip(board: BoardDef, firmware: string | Uint8Array, modules?: ChipModules): ChipLink {
  const r = new ChipRunner(board, firmware, modules)
  return { frame: async (f) => r.frame(f), serialWrite: (t) => r.serialWrite(t), dispose: () => {}, ui: (part, u) => r.ui(part, u) }
}
