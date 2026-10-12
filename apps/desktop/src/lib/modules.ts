// Arduino modules (the Microcontrollers catalogue: sensors, displays, radios …) as schematic parts.
// Each simulated catalogue module gets a KiCad-style symbol in the "Arduino_Modules" library:
// a box with the module's name, its supplies on top, ground below, the lines a controller drives
// on the left and the module's outputs on the right; displays get a screen inside the box where
// the running picture is drawn. In a schematic the module runs next to the board it is wired to
// (cosim/), its sliders are in the inspector, and analog / digital modules work in plain SPICE too.
import { CATALOG } from "@/mcu/catalog/data"
import { controlsOf, type CatalogPart, type Ctl } from "@/mcu/catalog/types"
import { addIndexRows, registerBuiltin, type IndexRow, type KPin, type SymbolDef } from "./kicad"

export const MODULE_LIB = "Arduino_Modules"

/** models that are modules (passives, gates, transistors … have KiCad symbols with SPICE models) */
const MODULE_MODELS = new Set(["i2c", "proto", "analog", "digital", "button", "led", "relay", "buzzer", "motor", "load", "lres", "siggen"])
/** run inside the board's emulator (they talk to the chip); the others are SPICE sources / loads */
export const CHIP_SIDE = new Set(["i2c", "proto"])

export interface ModuleInfo {
  /** "Arduino_Modules:Name" */
  id: string
  part: CatalogPart
  ctls: Ctl[]
  /** symbol pin number → catalogue pin name */
  pinName: Record<string, string>
  /** where the live view is drawn, in symbol px (the screen of a display, else a status strip) */
  screen: { x: number; y: number; w: number; h: number }
  display: boolean
}

const symName = (title: string) => title.replace(/[µ]/g, "u").replace(/Ω/g, "Ohm").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")

const POWER = /^(VCC|VDD|VIN|V\+|\+?5V|\+?3V3|\+?3\.3V|3V|VBUS|VBAT|VS|VMOT|VM|VLED|E\+|IOREF|VCC\d?)(\.\d+)?$/i
const GROUND = /^(GND|VSS|0V|AGND|DGND|E-|V-)(\.\d+)?$/i
/** lines a controller drives into the module */
const INPUT = /^(SDA|SCL|SCK|CLK|SCLK|MOSI|SDI|DIN|DI|CS|SS|NSS|CSN|CE|RX|RXD|RST|RES|RESET|DC|D\/C|RS|RW|E|EN|ENA|ENB|TRIG|IN\d*|DIR|STEP|PWM|CTRL|SET|T_CLK|T_CS|T_DIN|MCLK|BCLK|LRCLK|I2S_DIN|COIL\d?|A\d?|B\d?|CH\d+|SIG2|REC|PLAY|D\d+)(\.\d+)?$/i
/** lines the module drives */
const OUTPUT = /^(TX|TXD|MISO|SDO|DO|SO|DOUT|OUT\d*|AO|AOUT|ECHO|INT|IRQ|BUSY|ALERT|RDY|DRDY|T_DO|T_IRQ|I2S_DOUT|DQ|OUTPUT|CD|NO|NC|COM|Q|QN|VOUT|X|Y|Z|SEL|SW)(\.\d+)?$/i

type Side = "top" | "bottom" | "left" | "right"
function sideOf(name: string): Side | null {
  if (GROUND.test(name)) return "bottom"
  if (POWER.test(name)) return "top"
  if (INPUT.test(name)) return "left"
  if (OUTPUT.test(name)) return "right"
  return null
}

const PX = 12.7
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
/** text width in px at 8 px monospace */
const tw = (s: string, size = 8) => s.length * size * 0.6

function build(c: CatalogPart): { def: SymbolDef; info: ModuleInfo } {
  const id = `${MODULE_LIB}:${symName(c.title)}`
  const sides: Record<Side, { n: string; name: string }[]> = { top: [], bottom: [], left: [], right: [] }
  const loose: { n: string; name: string }[] = []
  c.pins.forEach((name, i) => {
    const p = { n: String(i + 1), name }
    const s = sideOf(name)
    if (s) sides[s].push(p); else loose.push(p)
  })
  // the rest goes where there is room
  for (const p of loose) (sides.left.length <= sides.right.length ? sides.left : sides.right).push(p)
  // many supplies / grounds: keep the top and bottom short
  while (sides.top.length > 4) sides.right.push(sides.top.pop()!)
  while (sides.bottom.length > 4) sides.left.push(sides.bottom.pop()!)

  const display = c.look.k === "screen" || /oled|lcd|tft|display|e-?paper|e-ink|matrix|ili9|ssd13|st77|gc9a/i.test(`${c.title} ${c.base ?? ""}`)
  const label = (c.look as { chip?: string; label?: string }).chip ?? (c.look as { label?: string }).label ?? ""
  // size in grid units (2 per pin), wide enough for the pin names and the title
  const rows = Math.max(sides.left.length, sides.right.length, display ? 4 : 2)
  const longL = Math.max(0, ...sides.left.map((p) => tw(p.name))), longR = Math.max(0, ...sides.right.map((p) => tw(p.name)))
  const titleW = Math.min(tw(c.title, 7) + 8, 150)
  let wGrid = Math.ceil((Math.max(longL + longR + 24 + (display ? 70 : 0), titleW, (Math.max(sides.top.length, sides.bottom.length) * 2) * PX) / PX) / 2) * 2
  wGrid = Math.max(wGrid, 8)
  let hGrid = rows * 2 + 2
  if (display) hGrid = Math.max(hGrid, 8)
  const hw = (wGrid / 2) * PX, hh = (hGrid / 2) * PX

  const kp: KPin[] = []
  let svg = `<rect x="${-hw}" y="${-hh}" width="${2 * hw}" height="${2 * hh}" rx="2" stroke-width="2" fill="var(--canvas-symbol-fill, none)"/>`
  for (const [side, list] of Object.entries(sides) as [Side, { n: string; name: string }[]][]) {
    list.forEach((p, i) => {
      const along = (i - (list.length - 1) / 2) * 2
      const [gx, gy, a] = side === "top" ? [Math.round(along), -hGrid / 2 - 1, 270] : side === "bottom" ? [Math.round(along), hGrid / 2 + 1, 90] : side === "left" ? [-wGrid / 2 - 1, Math.round(along), 0] : [wGrid / 2 + 1, Math.round(along), 180]
      const t = side === "top" || side === "bottom" ? "power_in" : side === "left" ? "input" : "output"
      kp.push({ n: p.n, name: p.name, x: gx, y: gy, a, t })
      const [x0, y0] = [gx * PX, gy * PX]
      const [x1, y1] = side === "top" ? [x0, -hh] : side === "bottom" ? [x0, hh] : side === "left" ? [-hw, y0] : [hw, y0]
      svg += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" class="kp"/>`
      const shown = esc(p.name.replace(/\.\d+$/, ""))
      const [tx, ty, anchor] = side === "top" ? [x0, -hh + 10, "middle"] : side === "bottom" ? [x0, hh - 4, "middle"] : side === "left" ? [-hw + 4, y0 + 3, "start"] : [hw - 4, y0 + 3, "end"]
      svg += `<text x="${tx}" y="${ty}" font-size="8" text-anchor="${anchor}" fill="currentColor" stroke="none" font-family="ui-monospace,monospace">${shown}</text>`
    })
  }
  // the module's name (and chip) in the middle; a display's screen under it
  const cx = (longL - longR) / 2
  const nameY = display ? -hh + 22 : -4
  const title = c.title.length > 26 ? `${c.title.slice(0, 25)}…` : c.title
  svg += `<text x="${cx}" y="${nameY}" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-weight="600">${esc(title)}</text>`
  if (label && label !== c.title) svg += `<text x="${cx}" y="${nameY + 10}" font-size="6.5" text-anchor="middle" fill="currentColor" stroke="none" opacity="0.7" font-family="ui-monospace,monospace">${esc(label)}</text>`
  const inner = { x: -hw + longL + 10, w: 2 * hw - longL - longR - 20 }
  const screen = display
    ? { x: inner.x, y: nameY + 16, w: Math.max(20, inner.w), h: Math.max(20, hh - (nameY + 16) - 14) }
    : { x: inner.x, y: nameY + (label ? 14 : 6), w: Math.max(20, inner.w), h: 12 }
  if (display) svg += `<rect x="${screen.x}" y="${screen.y}" width="${screen.w}" height="${screen.h}" rx="1.5" fill="#0b1020" stroke="currentColor" stroke-width="0.8" opacity="0.9"/>`

  const pinName: Record<string, string> = {}
  for (const p of kp) pinName[p.n] = p.name
  // the value shows what it is: its chip, else its name without the maker's range ("Light Sensor")
  const short = c.title.replace(/^(Grove|Gravity|M5Stack|DFRobot|Seeed|SparkFun|Adafruit)\s*[-:]?\s*/i, "").replace(/\s*\([^)]*\)$/, "")
  const value = label || (short.length > 22 ? `${short.slice(0, 21)}…` : short)
  const def: SymbolDef = {
    id, lib: MODULE_LIB, name: id.split(":")[1], bases: [], desc: c.hint, refPrefix: "U", value, power: false, excludeFromSim: false,
    units: [{ svg, pins: kp, box: [-hw - PX, -hh - PX, 2 * hw + 2 * PX, 2 * hh + 2 * PX] }],
    fields: { Reference: { v: "U", x: hw + 6, y: -hh + 2, j: "left" }, Value: { v: value, x: hw + 6, y: -hh + 14, j: "left" } },
  }
  return { def, info: { id, part: c, ctls: controlsOf(c.model), pinName, screen, display } }
}

const byId = new Map<string, ModuleInfo>()
const byType = new Map<string, ModuleInfo>()
for (const c of CATALOG) {
  if (c.board || c.noEmu || c.legacy || !MODULE_MODELS.has(c.model.m)) continue
  const { def, info } = build(c)
  if (byId.has(info.id)) continue // same title twice: the first wins
  registerBuiltin(def)
  byId.set(info.id, info)
  byType.set(c.type, info)
}

/** The module behind a schematic part's symbol ("Arduino_Modules:…"), if it is one. */
export const moduleOf = (lib: string | undefined): ModuleInfo | undefined => (lib ? byId.get(lib) : undefined)
export const moduleOfType = (type: string) => byType.get(type)
export const allModules = () => [...byId.values()]

/** Rows for the part index (search, sidebar, part browser). */
export function moduleRows(): IndexRow[] {
  return allModules().map((m) => ({
    lib: MODULE_LIB, name: m.id.split(":")[1], desc: m.part.hint,
    keywords: [m.part.group, m.part.sub ?? "", m.part.tags ?? "", "arduino module"].join(" "), ref: "U", units: 1, power: false, sim: true,
  }))
}

addIndexRows(moduleRows)

/** A module part's slider values: stored in the part's Sim.Params ("key=value …"), else the defaults. */
export function moduleControls(m: ModuleInfo, params: string | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of m.ctls) out[c.key] = c.def
  // the inspector's parameter parser lowercases keys: match them without case
  const keyOf = new Map(m.ctls.map((c) => [c.key.toLowerCase(), c.key]))
  for (const kv of (params ?? "").split(/\s+/)) {
    const [k, v] = kv.split("=")
    const key = k ? keyOf.get(k.toLowerCase()) : undefined
    if (key && v !== undefined && Number.isFinite(Number(v))) out[key] = Number(v)
  }
  return out
}

// ── SPICE: what a module is electrically (the chip-side ones are run by the board's emulator) ──
/**
 * Netlist lines for a module part. `nodeOf(pinName)` gives the SPICE node of a catalogue pin
 * (a fresh dangling node when unconnected). Analog / digital modules are sources that follow the
 * part's sliders; outputs (LED, buzzer, motor, load) are loads; a relay's coil switches its contacts.
 */
export function moduleSpice(m: ModuleInfo, ref: string, params: string | undefined, nodeOf: (pin: string) => string): string[] {
  const c = m.part, mod = c.model, id = ref.replace(/[^A-Za-z0-9_]/g, "_")
  const ctl = moduleControls(m, params)
  const flag = (k: string) => new RegExp(`(^|\\s)${k}=1(\\s|$)`).test(params ?? "")
  const lines: string[] = []
  const power = c.pins.find((p) => POWER.test(p))
  const vcc = power ? `V(${nodeOf(power)})` : "5"
  // every pin has a path to ground (an unconnected module never leaves a node floating)
  for (const p of c.pins) if (!GROUND.test(p)) lines.push(`R${id}_${symName(p)}_LEAK ${nodeOf(p)} 0 10Meg`)
  for (const p of c.pins) if (GROUND.test(p)) lines.push(`R${id}_${symName(p)}_GND ${nodeOf(p)} 0 1m`)
  // a source behind a resistor: v is an expression of the supply
  const out = (pin: string, v: string, r = 100) => { const n = `${id}_${symName(pin)}_src`; lines.push(`B${id}_${symName(pin)} ${n} 0 V=${v}`, `R${id}_${symName(pin)}_OUT ${n} ${nodeOf(pin)} ${r}`) }
  switch (mod.m) {
    case "analog": {
      // the curve is ratiometric: sample it at 5 V and scale with the module's supply
      const ratio = Math.max(0, Math.min(1, mod.f(ctl.value ?? mod.ctl.def, 5) / 5))
      out(mod.pin, `${ratio.toPrecision(6)}*${vcc}`)
      if (mod.dout) out(mod.dout, ratio > (mod.thr ?? 0.5) ? "0" : vcc)
      break
    }
    case "digital": { const on = flag("active"); out(mod.pin, on !== !!mod.low ? vcc : "0"); break }
    case "button": {
      const on = flag(mod.latch ? "active" : "pressed")
      if (on) out(mod.pin, mod.low ? "0" : vcc, 50); else out(mod.pin, mod.low ? vcc : "0", 10e3)
      break
    }
    case "led": lines.push(`R${id}_LED ${nodeOf(mod.pin)} 0 330`); break
    case "buzzer": lines.push(`R${id}_BUZ ${nodeOf(mod.pin)} 0 100`); break
    case "motor": lines.push(`R${id}_MOT ${nodeOf(mod.a)} ${mod.b ? nodeOf(mod.b) : "0"} ${mod.r ?? 10}`); break
    case "load": lines.push(`R${id}_LOAD ${nodeOf(mod.a)} ${mod.b ? nodeOf(mod.b) : "0"} ${mod.r}`); break
    case "lres": lines.push(`R${id}_RES ${nodeOf(mod.a)} ${nodeOf(mod.b)} ${Math.max(1, mod.r(ctl[mod.ctl.key] ?? mod.ctl.def)).toPrecision(6)}`); break
    case "relay": {
      // the coil (≈ 70 Ω), and contacts that close above half the pull-in voltage
      const [c1, c2] = mod.coil
      const ca = nodeOf(c1), cb = c2 ? nodeOf(c2) : "0"
      lines.push(`R${id}_COIL ${ca} ${cb} ${mod.ssr ? 1000 : 70}`)
      const vt = ((mod.vOn ?? 3) / 2).toPrecision(4)
      lines.push(`.model SW_${id}_ON SW(Ron=0.05 Roff=1e9 Vt=${vt} Vh=0.1)`, `.model SW_${id}_OFF SW(Ron=1e9 Roff=0.05 Vt=${vt} Vh=0.1)`)
      mod.com.forEach((com, i) => {
        if (mod.no[i]) lines.push(`S${id}_NO${i} ${nodeOf(com)} ${nodeOf(mod.no[i])} ${ca} ${cb} SW_${id}_ON`)
        if (mod.nc?.[i]) lines.push(`S${id}_NC${i} ${nodeOf(com)} ${nodeOf(mod.nc[i])} ${ca} ${cb} SW_${id}_OFF`)
      })
      break
    }
    case "siggen": {
      const kv = Object.fromEntries((params ?? "").split(/\s+/).map((s) => s.split("=")).filter((x) => x.length === 2))
      const f = Number(kv.freq ?? 1), amp = Number(kv.amp ?? 1), off = Number(kv.offset ?? 2.5)
      const n = `${id}_sig`
      lines.push(kv.wave === "square" ? `V${id}_SIG ${n} 0 PULSE(${off - amp} ${off + amp} 0 1u 1u ${1 / (2 * f)} ${1 / f})` : `V${id}_SIG ${n} 0 SIN(${off} ${amp} ${f})`)
      lines.push(`R${id}_SIGOUT ${n} ${nodeOf("SIG")} 50`)
      break
    }
    default: break // i2c / proto: the board's emulator runs them (cosim/); here only their pins' leakage
  }
  return lines
}
