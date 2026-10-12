// Arduino modules (lib/modules.ts) that talk to a chip — I²C, SPI, UART, 1-Wire … — run inside
// that board's emulator in a co-simulation, next to its firmware, exactly as on the
// Microcontrollers canvas (McuSim + the catalogue models): protocols need the chip's own timing,
// which a frame of the circuit simulator can't give. This finds them from the schematic's nets and
// describes them to the chip as a Wokwi-style diagram (board + modules + the wires between).
import type { Doc } from "@/editor/model"
import { deriveNetlist } from "@/editor/netlist"
import { getSymbol } from "@/lib/kicad"
import { CHIP_SIDE, moduleControls, moduleOf } from "@/lib/modules"
import type { BoardDef } from "@/mcu/boards"
import type { Connection, Diagram, DiagramPart } from "@/mcu/diagram"
import { boardParts, pinRole } from "./boards"

export interface BoardModules {
  /** the board and the modules wired to it (part ids are schematic refs) */
  diagram: Diagram
  /** module refs that run on this board */
  modules: string[]
  /** chip pins a module is wired to: the module side sets them, not the circuit simulator */
  owned: string[]
}

/** A module part's live state for the chip: its sliders, and pressed / active flags. */
export function moduleState(params: string | undefined, lib: string): { v: Record<string, number>; pressed: boolean; active: boolean } {
  const m = moduleOf(lib)
  const flag = (k: string) => new RegExp(`(^|\\s)${k}=1(\\s|$)`).test(params ?? "")
  return { v: m ? moduleControls(m, params) : {}, pressed: flag("pressed"), active: flag("active") }
}

/** For each board in the schematic: the chip-side modules wired to it (directly, on a shared net). */
export function boardModules(doc: Doc): Map<string, BoardModules> {
  const nl = deriveNetlist(doc)
  const out = new Map<string, BoardModules>()
  const taken = new Set<string>()
  for (const b of boardParts(doc)) {
    const sym = getSymbol(b.part.lib)
    if (!sym) continue
    // what each net is on this board: a chip pin, a supply, or ground
    const io = new Map<string, string>(), supply = new Map<string, number>(), gnd = new Set<string>()
    for (const u of sym.units) for (const p of u.pins) {
      const net = nl.pinNet.get(`${b.part.ref}.${p.n}`)
      if (!net) continue
      const r = pinRole(b.board, p.name)
      if (r?.k === "io") io.set(net, r.pin)
      else if (r?.k === "supply") supply.set(net, r.volts)
      else if (r?.k === "gnd") gnd.add(net)
    }
    const powerPin = (volts: number) => powerPinOf(b.board, volts)
    const parts: DiagramPart[] = [{ type: b.board.type, id: b.part.ref, top: 0, left: 0, attrs: {} }]
    const wires: Connection[] = []
    const modules: string[] = [], owned = new Set<string>()
    for (const p of doc.parts) {
      const m = moduleOf(p.lib)
      if (!m || !CHIP_SIDE.has(m.part.model.m) || taken.has(p.ref)) continue
      const links: Connection[] = []
      let wired = false
      for (const [n, name] of Object.entries(m.pinName)) {
        const net = nl.pinNet.get(`${p.ref}.${n}`)
        if (!net) continue
        const pin = io.get(net)
        if (pin) { links.push([`${b.part.ref}:${pin}`, `${p.ref}:${name}`, "", []]); owned.add(pin); wired = true; continue }
        if (gnd.has(net) || net === "0" || /^GND$/i.test(net)) { links.push([`${b.part.ref}:GND`, `${p.ref}:${name}`, "", []]); continue }
        const v = supply.get(net)
        if (v !== undefined) { links.push([`${b.part.ref}:${powerPin(v)}`, `${p.ref}:${name}`, "", []]); continue }
        // a supply from elsewhere in the circuit (a bench supply, a regulator): power the module from the board's
        if (/^(VCC|VDD|VIN|5V|3V3|3\.3V|V\+)/i.test(name)) links.push([`${b.part.ref}:${powerPin(b.board.vcc)}`, `${p.ref}:${name}`, "", []])
      }
      if (!wired) continue
      const st = moduleState(p.sim?.Params, p.lib)
      parts.push({ type: m.part.type, id: p.ref, top: 0, left: 0, attrs: { ...m.part.attrs, ...Object.fromEntries(Object.entries(st.v).map(([k, v]) => [k, String(v)])) } })
      wires.push(...links)
      modules.push(p.ref)
      taken.add(p.ref)
    }
    if (modules.length) out.set(b.part.ref, { diagram: { version: 1, author: "", editor: "spacebench", parts, connections: wires }, modules, owned: [...owned] })
  }
  return out
}

/** The board's power pin closest to `volts` ("5V", "3.3V", "3V3" …). */
function powerPinOf(board: BoardDef, volts: number): string {
  const e = Object.entries(board.power)
  return (e.find(([, v]) => Math.abs(v - volts) < 0.05) ?? e.find(([, v]) => Math.abs(v - board.vcc) < 0.05) ?? e[0] ?? ["5V"])[0]
}
