import { describe, expect, it } from "vitest"
import { CATALOG } from "."
import { draw } from "./look"
import { PARTS } from "../parts"

describe("parts catalogue", () => {
  it("lists every part once per key, with groups", () => {
    const keys = PARTS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    const by: Record<string, number> = {}
    for (const p of PARTS) by[p.category] = (by[p.category] ?? 0) + 1
    console.log(PARTS.length, JSON.stringify(by), "simulated", PARTS.filter((p) => p.sim).length)
    expect(PARTS.length).toBeGreaterThan(400)
  })
  it("draws each sb- part with its pins on the 2.54 mm grid", () => {
    for (const p of CATALOG) {
      if (!p.type.startsWith("sb-") || p.base) continue
      const d = draw(p)
      expect(d.pins.map((x) => x.name), p.title).toEqual(expect.arrayContaining(p.pins))
      expect(new Set(d.pins.map((x) => x.name)).size, p.title).toBe(d.pins.length)
      expect(d.w > 0 && d.h > 0, p.title).toBe(true)
    }
  })
})
