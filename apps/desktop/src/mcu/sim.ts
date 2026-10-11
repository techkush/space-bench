// A running microcontroller project: the AVR executing the sketch, the electrical circuit
// around it, and the devices on its pins — stepped in real time from the canvas.
//
// Every time a pin changes, the circuit is re-solved (cached by pin-state signature), the
// levels input pins read are pushed back into the chip, and the LED currents of the state
// that just ended are integrated, so PWM and multiplexed displays get the right brightness.
import { AvrMachine } from "./avr"
import type { Machine } from "./machine"
import { Rp2040Machine } from "./rp2040"
import { Esp32Machine } from "./esp32/machine"
import { boardByType, isBoardType, type BoardDef } from "./boards"
import { Circuit, type Drive, type PartUi, type PinLevel, type Solution } from "./circuit"
import { HD44780, I2CBus, LcdI2C, NeoPixelDecoder, SSD1306 } from "./devices"
import { splitEnd, type Diagram, type DiagramPart } from "./diagram"
import { catalogPart, controlsOf, type CatalogPart } from "./catalog"
import { makeDevice, type CatDevice, type SimCtx } from "./catalog/devices"
import { makeChip, type Chip } from "./catalog/i2c"
import type { ModView } from "./catalog/look"

export interface OledView { ram: Uint8Array; on: boolean; invert: boolean; version: number }
export interface LcdView { chars: Uint8Array; cursor: boolean; blink: boolean; x: number; y: number; backlight: boolean; version: number }
export interface Frame {
  /** part id → brightness per LED (0..1): one for an LED, 3 for RGB, 8×digits for a 7-segment … */
  leds: Map<string, number[]>
  servo: Map<string, number>
  /** part id → tone frequency (Hz), 0 = silent */
  buzzer: Map<string, number>
  lcd: Map<string, LcdView>
  oled: Map<string, OledView>
  neopixel: Map<string, [number, number, number][]>
  /** the board's own "L" LED */
  boardLed: number
  tx: boolean
  /** net → volts (for the wire tooltip) */
  volts: Float64Array
  warnings: string[]
  seconds: number
  /** simulated seconds per real second over the last frame */
  speed: number
  i2cMissing: number[]
  /** the state the circuit was solved for — what "Check with ngspice" exports */
  snapshot: Snapshot
  /** pin level changes since the last frame: [pin, seconds, 0 | 1 | 2 (floating)] */
  logic: [string, number, number][]
  /** the board pins that are wired (the analyser's channels) */
  logicPins: string[]
  /** several boards: each board's own "L" LED and TX (by board id); boardLed/tx are the focused one's */
  boards?: Record<string, { led: number; tx: boolean }>
  /** what catalogue parts show (relay on, pixels, digits, meter text …) */
  mods: Map<string, ModView>
}
export interface Snapshot { pins: [string, PinLevel][]; drives: [string, Drive][]; ui: Record<string, PartUi> }


export class McuSim {
  readonly machine: Machine
  readonly circuit: Circuit
  readonly board: BoardDef
  readonly boardId: string
  ui: Record<string, PartUi> = {}
  private drives = new Map<string, Drive>()
  private cache = new Map<string, Solution>()
  private sol: Solution
  private solAt = 0
  private ledInt = new Map<string, number[]>()
  private wiredPins: string[] = []
  private wiredSet = new Set<string>()
  private uiVersion = 0
  private lcds = new Map<string, { hd: HD44780; part: DiagramPart }>()
  private oleds = new Map<string, SSD1306>()
  private pixels = new Map<string, NeoPixelDecoder>()
  /** board pin → handlers for its edges */
  private edgeHooks = new Map<string, ((high: boolean, t: number) => void)[]>()
  private bus: I2CBus
  /** catalogue parts: their devices and I²C chips */
  private cat = new Map<string, CatDevice>()
  private chips = new Map<string, Chip>()
  private serialActive = 0
  onSerial: ((text: string) => void) | null = null

  readonly diagram: Diagram

  constructor(diagram: Diagram, firmware: string | Uint8Array, eeprom?: Uint8Array) {
    this.diagram = diagram
    const bp = diagram.parts.find((p) => isBoardType(p.type))
    if (!bp) throw new Error("Add a board (Arduino Uno, Nano, Mega or Raspberry Pi Pico) to the diagram")
    this.board = boardByType(bp.type)!
    this.boardId = bp.id
    if (this.board.chip === "esp32") {
      this.machine = new Esp32Machine(this.board)
    } else if (this.board.chip === "rp2040") {
      if (typeof firmware === "string") throw new Error("The Pico needs a .bin flash image")
      this.machine = new Rp2040Machine(this.board, firmware)
    } else {
      if (typeof firmware !== "string") throw new Error("AVR boards need an Intel HEX file")
      this.machine = new AvrMachine(this.board, firmware, eeprom)
    }
    this.circuit = new Circuit(diagram, this.board)
    for (const pin of Object.keys(this.board.pins)) if (this.circuit.wired(this.boardId, pin)) this.wiredPins.push(pin)
    this.wiredSet = new Set(this.wiredPins)
    this.bus = new I2CBus((ev) => this.machine.attachI2C(ev))
    this.machine.onSerial = (s) => { this.serialActive = this.machine.now; this.onSerial?.(s) }
    this.machine.onPinChange = (pins) => this.pinsChanged(pins)
    for (const p of diagram.parts) { this.attach(p); this.attachCatalog(p) }
    this.moduleDrives()
    this.sol = this.solveNow()
    this.apply(this.sol)
    for (const pin of this.wiredPins) this.logPin(pin, this.levelOf(pin))
  }

  // ── devices ────────────────────────────────────────────────────────────────────────────
  /** The board pin that drives a part's pin (same net), if any. */
  private boardPinFor(partId: string, pin: string): string | null {
    const n = this.circuit.net(partId, pin)
    if (n < 0) return null
    for (const bp of Object.keys(this.board.pins)) if (this.circuit.boardNet.get(bp) === n) return bp
    return null
  }
  private hook(pin: string | null, fn: (high: boolean, t: number) => void) {
    if (!pin) return
    this.edgeHooks.set(pin, [...(this.edgeHooks.get(pin) ?? []), fn])
  }
  private level(pin: string | null): boolean { return !!pin && this.machine.track.get(pin)?.out === true }

  private attach(p: DiagramPart) {
    const t = p.type.replace(/^wokwi-/, "")
    const m = this.machine
    const hz = m.hz
    if (t === "lcd1602" || t === "lcd2004") {
      const hd = new HD44780(t === "lcd2004" ? 20 : 16, t === "lcd2004" ? 4 : 2)
      this.lcds.set(p.id, { hd, part: p })
      if ((p.attrs.pins ?? "full") === "i2c") {
        const x = new LcdI2C(hd)
        this.bus.devices.set(Number(p.attrs.i2cAddress ?? "0x27"), { write: (b) => x.write(b) })
      } else {
        const e = this.boardPinFor(p.id, "E"), rs = this.boardPinFor(p.id, "RS")
        const d = ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"].map((x) => this.boardPinFor(p.id, x))
        const eight = d.slice(0, 4).every((x) => x)
        hd.backlight = true
        this.hook(e, (high) => {
          if (high) return
          const bits = (pins: (string | null)[]) => pins.reduce((v, pin, i) => v | (this.level(pin) ? 1 << i : 0), 0)
          if (eight) hd.write(this.level(rs), bits(d))
          else hd.writeNibble(this.level(rs), bits(d.slice(4)))
        })
      }
    } else if (t === "ssd1306") {
      const o = new SSD1306()
      this.oleds.set(p.id, o)
      this.bus.devices.set(Number(p.attrs.i2cAddress ?? "0x3c"), { start: () => o.start(), write: (b) => o.byte(b) })
    } else if (t === "neopixel" || t === "led-ring" || t === "neopixel-matrix") {
      const dec = new NeoPixelDecoder(hz, Number(p.attrs.pixels ?? 1))
      this.pixels.set(p.id, dec)
      this.hook(this.boardPinFor(p.id, "DIN"), (high, at) => dec.edge(high, at))
    } else if (t === "hc-sr04") {
      const trig = this.boardPinFor(p.id, "TRIG")
      let rise = -1
      this.hook(trig, (high, at) => {
        if (high) { rise = at; return }
        if (rise < 0 || (at - rise) / hz < 8e-6) return
        const cm = Math.max(2, Math.min(400, this.ui[p.id]?.value ?? Number(p.attrs.distance ?? 100)))
        const key = `${p.id}:ECHO`
        m.schedule(() => {
          this.drive(key, { v: 5, r: 50 })
          m.schedule(() => this.drive(key, { v: 0, r: 50 }), Math.round(cm * 58e-6 * hz))
        }, Math.round(250e-6 * hz))
      })
      this.drives.set(`${p.id}:ECHO`, { v: 0, r: 50 })
    } else if (t === "dht22") {
      const sda = this.boardPinFor(p.id, "SDA")
      let lowAt = -1
      this.hook(sda, () => {
        const tr = sda ? this.machine.track.get(sda) : null
        if (!tr) return
        if (tr.out === false) { lowAt = m.now; return }
        if (tr.out !== null || lowAt < 0 || (m.now - lowAt) / hz < 500e-6) return
        lowAt = -1
        // the MCU released the line after its start pulse: answer
        const u = this.ui[p.id] ?? {}
        const hum = Math.round((u.y ?? Number(p.attrs.humidity ?? 40)) * 10)
        const temp = Math.round((u.value ?? Number(p.attrs.temperature ?? 24)) * 10)
        const tw = temp < 0 ? 0x8000 | -temp : temp
        const bytes = [hum >> 8, hum & 0xff, tw >> 8, tw & 0xff]
        bytes.push(bytes.reduce((a, b) => a + b, 0) & 0xff)
        const seq: [boolean, number][] = [[false, 80], [true, 80]]
        for (const b of bytes) for (let i = 7; i >= 0; i--) seq.push([false, 50], [true, b & (1 << i) ? 70 : 26])
        seq.push([false, 50])
        const key = `${p.id}:SDA`
        let at = 30
        for (const [high, us] of seq) {
          m.schedule(() => (high ? this.drive(key, null) : this.drive(key, { v: 0, r: 20 })), Math.round(at * 1e-6 * hz))
          at += us
        }
        m.schedule(() => this.drive(key, null), Math.round(at * 1e-6 * hz))
      })
    }
  }

  // ── catalogue parts ────────────────────────────────────────────────────────────────────
  private ctxFor(p: DiagramPart, c: CatalogPart): SimCtx {
    const m = this.machine
    const key = (pin: string) => `${p.id}:${pin}`
    const ctls = controlsOf(c.model)
    const hwRx: Record<string, string> = { atmega328p: "0", atmega2560: "0", rp2040: "GP1", esp32: "RX0" }
    return {
      hz: m.hz, vcc: this.board.vcc, attrs: p.attrs,
      now: () => m.now,
      pin: (pin) => this.boardPinFor(p.id, pin),
      track: (bp) => (bp ? m.track.get(bp) : undefined),
      hook: (bp, fn) => this.hook(bp, (_h, t) => fn(t)),
      drive: (pin, d) => this.drive(key(pin), d),
      set: (pin, d) => { if (d) this.drives.set(key(pin), d); else this.drives.delete(key(pin)) },
      after: (s, fn) => m.schedule(fn, Math.max(1, Math.round(s * m.hz))),
      i2c: (addr, dev) => this.bus.devices.set(addr, dev),
      ctl: (k) => {
        const u = this.ui[p.id]
        const v = u?.v?.[k] ?? (k === "value" ? u?.value : undefined)
        if (v !== undefined) return v
        const a = Number(p.attrs[k])
        return Number.isFinite(a) && p.attrs[k] !== "" ? a : ctls.find((x) => x.key === k)?.def ?? 0
      },
      ui: () => this.ui[p.id] ?? {},
      supply: (pin) => this.circuit.supply(this.circuit.net(p.id, pin)),
      volts: (pin) => { const n = this.circuit.net(p.id, pin); return n < 0 ? 0 : this.sol?.v[n] ?? 0 },
      serialIn: (text) => { const bp = this.boardPinFor(p.id, "TX"); if (!bp || bp !== hwRx[this.board.chip]) return false; m.serialWrite(text); return true },
      peers: (kind) => [...this.cat.values()].filter((d) => d.kind === kind),
      setState: (patch) => this.setUi(p.id, { v: { ...this.ui[p.id]?.v, ...patch } }),
    }
  }
  private attachCatalog(p: DiagramPart) {
    const c = catalogPart(p.type)
    if (!c || c.legacy) return
    const ctx = this.ctxFor(p, c)
    if (c.model.m === "i2c") {
      const chip = makeChip(c.model.chip, Number(p.attrs.i2cAddress ?? c.model.addr), ctx)
      if (!chip) return
      for (const [addr, dev] of chip.devices) this.bus.devices.set(addr, dev)
      if (chip.lcd) this.lcds.set(p.id, { hd: chip.lcd, part: p })
      if (chip.oled) this.oleds.set(p.id, chip.oled)
      this.chips.set(p.id, chip)
      return
    }
    const dev = makeDevice(c, ctx)
    if (!dev) return
    this.cat.set(p.id, dev)
    if (dev.kind === "ws2812") {
      const dec = new NeoPixelDecoder(this.machine.hz, Number(p.attrs.pixels ?? 1))
      this.pixels.set(p.id, dec)
      const din = c.model.m === "proto" ? c.model.pins?.din ?? "DIN" : "DIN"
      this.hook(this.boardPinFor(p.id, din), (high, at) => dec.edge(high, at))
    }
  }

  /** A device output changed: re-solve right away (the sketch may be timing it). */
  private drive(key: string, d: Drive | null) {
    if (d) this.drives.set(key, d); else this.drives.delete(key)
    this.uiVersion++
    this.refresh()
  }

  /** Sensor modules: outputs that follow the user's controls. */
  private moduleDrives() {
    for (const p of this.diagram.parts) {
      const t = p.type.replace(/^wokwi-/, "")
      const u = this.ui[p.id] ?? {}
      const vcc = this.circuit.supply(this.circuit.net(p.id, "VCC"))
      const set = (pin: string, v: number, r: number) => this.drives.set(`${p.id}:${pin}`, { v, r })
      if (t === "ntc-temperature-sensor") {
        const c = u.value ?? Number(p.attrs.temperature ?? 24)
        const rn = 10e3 * Math.exp(3950 * (1 / (c + 273.15) - 1 / 298.15))
        set("OUT", (vcc * rn) / (rn + 10e3), (rn * 10e3) / (rn + 10e3))
      } else if (t === "photoresistor-sensor") {
        const lux = Math.max(0.1, u.value ?? Number(p.attrs.lux ?? 500))
        const r = 50e3 * Math.pow(10 / lux, 0.7)
        const ao = (vcc * r) / (r + 10e3)
        set("AO", ao, (r * 10e3) / (r + 10e3))
        set("DO", ao > vcc * Number(p.attrs.threshold ?? 0.5) ? vcc : 0, 100)
      } else if (t === "analog-joystick") {
        set("HORZ", vcc * (1 - ((u.x ?? 0) + 1) / 2), 100)
        set("VERT", vcc * (((u.y ?? 0) + 1) / 2), 100)
        if (u.pressed) set("SEL", 0, 1); else this.drives.delete(`${p.id}:SEL`)
      } else if (t === "pir-motion-sensor" || t === "tilt-switch") {
        set("OUT", u.active ? vcc : 0, 100)
      }
    }
    for (const d of this.cat.values()) d.drives?.()
    for (const c of this.chips.values()) c.drives?.()
  }

  // ── solving ────────────────────────────────────────────────────────────────────────────
  private pinLevels(): Map<string, PinLevel> {
    const m = new Map<string, PinLevel>()
    for (const pin of this.wiredPins) { const t = this.machine.track.get(pin); if (t) m.set(pin, { out: t.out, pullup: t.pullup, pulldown: t.pulldown }) }
    return m
  }
  private signature(): string {
    let s = `${this.uiVersion}|${this.circuit.stateKey()}|`
    for (const pin of this.wiredPins) { const t = this.machine.track.get(pin); s += t ? (t.out === null ? (t.pullup ? "u" : t.pulldown ? "d" : "z") : t.out ? "1" : "0") : "-" }
    return s
  }
  private solveNow(): Solution {
    const sig = this.signature()
    let s = this.cache.get(sig)
    if (!s) {
      s = this.circuit.solve(this.pinLevels(), this.ui, this.drives, this.sol?.inputs)
      if (this.cache.size > 512) this.cache.clear()
      this.cache.set(sig, s)
    }
    return s
  }
  // ── logic analyser: every level change of a wired board pin, time-stamped ──
  private logicLast = new Map<string, number>()
  private logic: [string, number, number][] = []
  private logPin(pin: string, level: number) {
    if (this.logicLast.get(pin) === level) return
    this.logicLast.set(pin, level)
    if (this.logic.length < 20000) this.logic.push([pin, this.machine.now / this.machine.hz, level])
  }
  /** a pin's level: what it drives, or (an input) what it reads; 2 = floating */
  private levelOf(pin: string): number {
    const t = this.machine.track.get(pin)
    if (t?.out === true) return 1
    if (t?.out === false) return 0
    const r = this.sol?.inputs.get(pin)
    return r === undefined ? 2 : r ? 1 : 0
  }

  private apply(s: Solution) {
    for (const [pin, high] of s.inputs) { this.machine.setInput(pin, high); if (this.wiredSet.has(pin)) this.logPin(pin, high ? 1 : 0) }
    for (const [ch, v] of s.adc) this.machine.setAnalog(ch, v)
  }
  private integrate(now: number) {
    const dt = now - this.solAt
    if (dt <= 0) return
    for (const l of this.sol.leds) {
      let arr = this.ledInt.get(l.part)
      if (!arr) this.ledInt.set(l.part, (arr = []))
      arr[l.index] = (arr[l.index] ?? 0) + l.current * dt
    }
    this.solAt = now
  }
  private refresh() {
    const now = this.machine.now
    this.integrate(now)
    const s = this.solveNow()
    if (s !== this.sol) { this.sol = s; this.apply(s); for (const d of this.cat.values()) d.solved?.() }
  }
  private pinsChanged(pins: string[]) {
    const t = this.machine.now
    this.refresh()
    for (const pin of pins) if (this.wiredSet.has(pin)) this.logPin(pin, this.levelOf(pin))
    for (const pin of pins) {
      const hooks = this.edgeHooks.get(pin)
      if (hooks) { const high = this.machine.track.get(pin)?.out === true; for (const h of hooks) h(high, t) }
    }
  }

  /** The user pressed / turned / switched something. */
  setUi(id: string, u: PartUi) {
    const old = this.ui[id]
    this.ui = { ...this.ui, [id]: { ...old, ...u, ...(u.v ? { v: { ...old?.v, ...u.v } } : {}) } }
    this.uiVersion++
    this.cache.clear()
    this.cat.get(id)?.ui?.(u)
    this.moduleDrives()
    this.refresh()
  }

  serialWrite(text: string) { this.machine.serialWrite(text) }

  /** Run `ms` of simulated time; returns what to draw. */
  step(ms: number, realMs: number): Frame {
    const start = this.machine.now
    this.machine.runFor((ms / 1000) * this.machine.hz)
    const now = this.machine.now
    this.integrate(now)
    for (const d of this.pixels.values()) d.idle(now)
    const span = now - start
    const window = this.machine.takeWindow()
    const leds = new Map<string, number[]>()
    for (const [id, arr] of this.ledInt) leds.set(id, arr.map((q) => Math.min(1, Math.sqrt(q / span / 0.012))))
    this.ledInt.clear()
    // parts whose state is steady (no LED current recorded) still need an entry so they turn off
    for (const p of this.diagram.parts) if (!leds.has(p.id)) leds.set(p.id, [])
    const servo = new Map<string, number>()
    const buzzer = new Map<string, number>()
    for (const p of this.diagram.parts) {
      const t = p.type.replace(/^wokwi-/, "")
      if (t === "servo") {
        const pin = this.boardPinFor(p.id, "PWM")
        const tr = pin ? this.machine.track.get(pin) : null
        if (tr && tr.pulse > 0) {
          const us = (tr.pulse / this.machine.hz) * 1e6
          if (us > 400 && us < 2700) servo.set(p.id, Math.max(0, Math.min(180, ((us - 544) / (2400 - 544)) * 180)))
        }
      } else if (t === "buzzer") {
        const pin = this.boardPinFor(p.id, "1") ?? this.boardPinFor(p.id, "2")
        const tr = pin ? this.machine.track.get(pin) : null
        const w = pin ? window.get(pin) : null
        buzzer.set(p.id, tr && w && w.toggles >= 2 && tr.period > 0 ? this.machine.hz / tr.period : 0)
      }
    }
    const lcd = new Map<string, LcdView>()
    for (const [id, { hd }] of this.lcds) { const c = hd.cursorPos; lcd.set(id, { chars: hd.characters(), cursor: hd.cursor, blink: hd.blink, x: c.x, y: c.y, backlight: hd.backlight, version: hd.version }) }
    const neopixel = new Map<string, [number, number, number][]>()
    for (const [id, d] of this.pixels) neopixel.set(id, d.colors)
    const mods = new Map<string, ModView>(this.sol.views)
    const dt = span / this.machine.hz
    for (const [id, d] of this.cat) {
      d.frame?.(dt)
      const v = d.view?.()
      if (v) mods.set(id, { ...mods.get(id), ...v })
      const hz = d.tone?.()
      if (hz !== undefined) buzzer.set(id, hz)
      if (d.kind === "ws2812") mods.set(id, { pix: this.pixels.get(id)?.colors ?? [] })
    }
    for (const [id, c] of this.chips) { const v = c.view?.(); if (v) mods.set(id, { ...mods.get(id), ...v }) }
    return {
      leds, servo, buzzer, lcd, neopixel,
      oled: new Map([...this.oleds].map(([id, o]) => [id, { ram: o.ram.slice(), on: o.on, invert: o.invert, version: o.version }])),
      boardLed: window.get(this.board.led)?.duty ?? 0,
      tx: now - this.serialActive < this.machine.hz * 0.05,
      volts: this.sol.v, warnings: this.sol.warnings,
      seconds: this.machine.seconds, speed: realMs > 0 ? ms / realMs : 1,
      i2cMissing: [...this.bus.missing].filter((a) => !this.bus.devices.has(a)),
      snapshot: { pins: [...this.pinLevels()], drives: [...this.drives], ui: this.ui },
      logic: this.logic.splice(0), logicPins: this.wiredPins, mods,
    }
  }

  /** Voltage of the net a part's pin is on. */
  voltsAt(partId: string, pin: string): number | null {
    const n = this.circuit.net(partId, pin)
    return n < 0 ? null : this.sol.v[n] ?? null
  }

  static partOf(end: string) { return splitEnd(end)[0] }
}
