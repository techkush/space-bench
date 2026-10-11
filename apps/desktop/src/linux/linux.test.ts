// A Raspberry Pi (Linux in a VM) in a schematic: real Python + gpiozero on the board, the circuit
// on ngspice, in lockstep. Needs QEMU and the set-up system (Settings → Linux boards); skipped
// otherwise. Boots a VM, so it takes ~10 s.
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { afterEach, describe, expect, it, vi } from "vitest"
import { linuxBackend } from "../../vite-linux"
import { run } from "../../vite-ngspice"

vi.mock("./host", () => ({
  linuxStatus: async () => linuxBackend.status(),
  linuxStart: async (o: Parameters<typeof linuxBackend.start>[0]) => linuxBackend.start(o),
  linuxStop: async () => linuxBackend.stop(),
  linuxQmp: async (cmd: string) => linuxBackend.qmp(cmd),
  linuxPoll: async () => linuxBackend.poll(),
  linuxSend: async (o: { console?: string; agent?: string }) => linuxBackend.send(o),
}))

import { compileKirk } from "@/kirk/compile"
import { boardParts } from "@/cosim/boards"
import { CoSim } from "@/cosim/cosim"
import { remap, type JobResult } from "@/lib/engine"
import { setLoader } from "@/lib/kicad"
import type { SpiceNetlist } from "@/lib/spice"
import { linuxChip } from "./chip"
import { linuxVm } from "./agent"

const KICAD = path.resolve(import.meta.dirname, "../../public/kicad")
setLoader(async (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(KICAD, `${f}.gz`))).toString()))
const ngspice = ["/opt/homebrew/bin/ngspice", "/usr/local/bin/ngspice"].find((p) => fs.existsSync(p))
const st = linuxBackend.status()
const ready = !!st.qemu && !!st.boot && !!ngspice

const simulate = async (net: SpiceNetlist): Promise<JobResult> => {
  const r = await run(net.text)
  if (r.status !== 200) throw new Error(r.body)
  return remap(JSON.parse(r.body) as JobResult, net)
}

describe.skipIf(!ready)("Raspberry Pi (Linux VM) in a schematic", { timeout: 180_000 }, () => {
  // a failed test must not leave its VM holding the disk
  afterEach(async () => { await linuxVm().shutdown() })

  it("gpiozero blinks an LED through the circuit and reads a pulled-down input", async () => {
    const r = await compileKirk(`circuit PiLed {
    ground GND
    P1 = lib("Connector:Raspberry_Pi_4")
    R1 = R(330)
    D1 = LED("Red")
    R2 = R(1k)
    P1.11 -- R1 -- A -- D1' -- GND
    P1.13 -- IN -- R2 -- GND
    P1.6 -- GND
}
simulate tran(stop: 1 s, step: 1 ms)
`)
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    const doc = r.doc!
    const [b] = boardParts(doc)
    expect(b.board.name).toBe("Raspberry Pi 4B")
    // GPIO17 (header pin 11) toggles every 100 ms; GPIO27 (pin 13) has 1 kΩ to ground: a pressed button
    const program = `from gpiozero import LED, Button
from time import sleep
led = LED(17); btn = Button(27)
while True:
    led.toggle()
    print("lit" if led.is_lit else "off", "pressed" if btn.is_pressed else "released", flush=True)
    sleep(0.1)
`
    const chip = await linuxChip(b.board, { files: [{ name: "main.py", content: program }] })
    const sim = new CoSim(doc, [{ ref: b.part.ref, board: b.board, chip }], simulate, { frame: 0.05 })
    let serial = ""
    const ma: number[] = []
    const t0 = performance.now()
    while (sim.t < 1) { const f = await sim.step(); serial += f.serial[b.part.ref]; ma.push((f.avg["I(D1)"] ?? 0) * 1000) }
    const wall = (performance.now() - t0) / 1000
    sim.dispose()
    await linuxVm().shutdown()
    console.log(`1 s of Pi + circuit in ${wall.toFixed(1)} s; LED mA per 50 ms frame:`, ma.map((x) => x.toFixed(1)).join(" "))
    // 100 ms on / 100 ms off in 50 ms frames: frames fully lit (≈ (3.3 − 1.8) / 355 ≈ 4 mA), dark,
    // and the ones a toggle falls inside; on average half the lit current
    expect(ma.filter((x) => x > 3.8).length).toBeGreaterThanOrEqual(4)
    expect(ma.filter((x) => x < 0.3).length).toBeGreaterThanOrEqual(4)
    const mean = ma.reduce((a, b) => a + b, 0) / ma.length
    expect(mean).toBeGreaterThan(1.6)
    expect(mean).toBeLessThan(2.7)
    expect(serial).toContain("pressed")
    expect(serial).not.toContain("released")
  })
})
