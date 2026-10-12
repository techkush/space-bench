// Arduino modules as schematic parts: every simulated catalogue module has a symbol whose pins are
// its pins, and the SPICE side (analog / digital modules as sources, relays switching) runs.
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { describe, expect, it } from "vitest"
import type { Doc } from "@/editor/model"
import { deriveNetlist } from "@/editor/netlist"
import { remap, type JobResult } from "@/lib/engine"
import { getSymbol, loadIndex, setLoader } from "@/lib/kicad"
import { buildNetlist } from "@/lib/spice"
import { compileKirk } from "@/kirk/compile"
import { CATALOG } from "@/mcu/catalog/data"
import { run } from "../../vite-ngspice"
import { allModules, MODULE_LIB, moduleOf } from "./modules"

const KICAD = path.resolve(import.meta.dirname, "../../public/kicad")
setLoader(async (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(KICAD, `${f}.gz`))).toString()))
const ngspice = ["/opt/homebrew/bin/ngspice", "/usr/local/bin/ngspice", "/usr/bin/ngspice"].find((p) => fs.existsSync(p))

async function sim(doc: Doc): Promise<JobResult> {
  const net = buildNetlist(doc, deriveNetlist(doc), "op")
  const r = await run(net.text)
  if (r.status !== 200) throw new Error(`${r.body}\n${net.text}`)
  return remap(JSON.parse(r.body) as JobResult, net)
}
const op = (r: JobResult, n: string) => (r.type === "op" ? r.values[r.names.indexOf(n)] : NaN)
const withParams = (d: Doc, ref: string, params: string): Doc => ({ ...d, parts: d.parts.map((p) => (p.ref === ref ? { ...p, sim: { ...p.sim, Params: params } } : p)) })

describe("Arduino modules as schematic symbols", () => {
  it("every simulated catalogue module has a symbol with its pins, on the grid, none overlapping", () => {
    const mods = allModules()
    expect(mods.length).toBeGreaterThan(250)
    for (const m of mods) {
      const s = getSymbol(m.id)!
      expect(s, m.id).toBeTruthy()
      const pins = s.units[0].pins
      expect(pins.map((p) => p.name).sort(), m.id).toEqual([...m.part.pins].sort())
      expect(new Set(pins.map((p) => `${p.x},${p.y}`)).size, `${m.id} pins overlap`).toBe(pins.length)
      for (const p of pins) expect(Number.isInteger(p.x) && Number.isInteger(p.y), `${m.id} ${p.name} off grid`).toBe(true)
    }
    // the familiar ones are there
    for (const t of ["sb-max31856-universal-thermocouple", "sb-epaper-2-9-296-128-b-w", "sb-grove-nfc-pn532"]) expect(allModules().some((m) => m.part.type === t), t).toBe(true)
    expect(CATALOG.filter((c) => c.model.m === "i2c" && !c.board).every((c) => allModules().some((m) => m.part.type === c.type) || allModules().some((m) => m.part.title === c.title))).toBe(true)
  })

  it("the part index lists them (search, sidebar, part browser)", async () => {
    const rows = (await loadIndex()).filter((r) => r.lib === MODULE_LIB)
    expect(rows.length).toBe(allModules().length)
    expect(rows.every((r) => r.sim)).toBe(true)
  })

  it.skipIf(!ngspice)("an analog module is a source that follows its slider, ratiometric to its supply", async () => {
    const m = allModules().find((x) => x.part.model.m === "analog" && x.part.pins.includes("VCC") && x.part.pins.includes("GND") && x.part.pins.includes("SIG"))!
    const r = await compileKirk(`circuit T {
    ground GND
    V1 = Vdc(5 V)
    U1 = lib("${m.id}")
    VCC -- V1 -- GND
    U1.VCC -- VCC
    U1.GND -- GND
    U1.SIG -- OUT
}
simulate op
`)
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    const doc = r.doc!
    const ref = doc.parts.find((p) => moduleOf(p.lib))!.ref
    const model = m.part.model as Extract<typeof m.part.model, { m: "analog" }>
    for (const x of [model.ctl.min, (model.ctl.min + model.ctl.max) / 2, model.ctl.max]) {
      const v = op(await sim(withParams(doc, ref, `value=${x}`)), "V(OUT)")
      const want = Math.max(0, Math.min(5, model.f(x, 5)))
      expect(Math.abs(v - want), `${m.id} at ${x}: ${v} V, want ${want} V`).toBeLessThan(0.05)
    }
  })

  it.skipIf(!ngspice)("a relay module's coil switches its contacts", async () => {
    const m = allModules().find((x) => x.part.model.m === "relay" && !(x.part.model as { ssr?: boolean }).ssr && (x.part.model as { coil: string[] }).coil.length === 1)
    if (!m) return
    const model = m.part.model as Extract<typeof m.part.model, { m: "relay" }>
    const r = await compileKirk(`circuit T {
    ground GND
    V1 = Vdc(5 V)
    V2 = Vdc(5 V)
    R1 = R(1k)
    U1 = lib("${m.id}")
    VCC -- V1 -- GND
    CTL -- V2 -- GND
    U1.${model.coil[0]} -- CTL
    ${m.part.pins.includes("VCC") ? "U1.VCC -- VCC" : ""}
    ${m.part.pins.includes("GND") ? "U1.GND -- GND" : ""}
    U1.${model.com[0]} -- VCC
    U1.${model.no[0]} -- LOAD -- R1 -- GND
}
simulate op
`)
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    expect(op(await sim(r.doc!), "V(LOAD)")).toBeGreaterThan(4.5)
  })
})
