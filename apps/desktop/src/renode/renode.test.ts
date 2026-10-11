// STM32 boards on Renode in a schematic: a real stm32duino sketch (arduino-cli) on the emulated
// chip, the circuit on ngspice, in lockstep. Needs Renode, arduino-cli with the STM32 core and
// ngspice; skipped otherwise.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { afterEach, describe, expect, it, vi } from "vitest"
import { renodeBackend } from "../../vite-renode"
import { run } from "../../vite-ngspice"

vi.mock("./host", () => ({
  renodeStart: async (helper: string) => { const dir = await renodeBackend.start(helper); return path.join(dir, "sb_renode.py") },
  renodeCmd: async (line: string) => renodeBackend.cmd(line),
  renodeStop: async () => renodeBackend.stop(),
  renodeStage: async (elf: string) => renodeBackend.stage(elf),
}))

import { compileKirk } from "@/kirk/compile"
import { boardParts } from "@/cosim/boards"
import { CoSim } from "@/cosim/cosim"
import { remap, type JobResult } from "@/lib/engine"
import { setLoader } from "@/lib/kicad"
import type { SpiceNetlist } from "@/lib/spice"
import { boardByType } from "@/mcu/boards"
import { renodeChip } from "./chip"

const KICAD = path.resolve(import.meta.dirname, "../../public/kicad")
setLoader(async (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(KICAD, `${f}.gz`))).toString()))
const ngspice = ["/opt/homebrew/bin/ngspice", "/usr/local/bin/ngspice"].find((p) => fs.existsSync(p))
const cli = ["/opt/homebrew/bin/arduino-cli", "/usr/local/bin/arduino-cli"].find((p) => fs.existsSync(p))
const hasStm32 = !!cli && execFileSync(cli, ["core", "list"], { encoding: "utf8" }).includes("STMicroelectronics:stm32")
const ready = !!renodeBackend.status().renode && !!ngspice && hasStm32

function build(code: string, board: NonNullable<ReturnType<typeof boardByType>>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbrenode-"))
  const sk = path.join(dir, "sketch"); fs.mkdirSync(sk)
  fs.writeFileSync(path.join(sk, "sketch.ino"), code)
  for (const f of board.renode?.sources ?? []) fs.writeFileSync(path.join(sk, f.name), f.content)
  execFileSync(cli!, ["compile", "--fqbn", board.fqbn, "--build-path", path.join(os.tmpdir(), `sbrenode-build-${board.id}`), "--output-dir", path.join(dir, "out"), sk], { encoding: "utf8" })
  return path.join(dir, "out", "sketch.ino.elf")
}

const simulate = async (net: SpiceNetlist): Promise<JobResult> => {
  const r = await run(net.text)
  if (r.status !== 200) throw new Error(r.body)
  return remap(JSON.parse(r.body) as JobResult, net)
}

const SKETCH = `void setup() { Serial.begin(115200); pinMode(LED_BUILTIN, OUTPUT); pinMode(PA0, INPUT_PULLDOWN); }
void loop() { digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN)); delay(50); Serial.print("btn="); Serial.println(digitalRead(PA0)); }`

describe.skipIf(!ready)("STM32 on Renode in a schematic", { timeout: 300_000 }, () => {
  afterEach(() => renodeBackend.stop())

  it("a bare STM32F407 blinks an LED through the circuit and reads a pulled-up input", async () => {
    const r = await compileKirk(`circuit Stm32Led {
    ground GND
    U1 = lib("MCU_ST_STM32F4:STM32F407VGTx")
    V1 = Vdc(3.3 V)
    R1 = R(330)
    D1 = LED("Red")
    R2 = R(10k)
    VDD -- V1 -- GND
    U1.PD12 -- R1 -- A -- D1' -- GND
    U1.PA0 -- IN -- R2 -- VDD
}
simulate tran(stop: 1 s, step: 1 ms)
`)
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    const doc = r.doc!
    const [b] = boardParts(doc)
    expect(b.board.name).toBe("STM32F4 Discovery")
    const chip = await renodeChip(b.board, build(SKETCH, b.board))
    const sim = new CoSim(doc, [{ ref: b.part.ref, board: b.board, chip }], simulate, { frame: 0.025 })
    let serial = ""
    const ma: number[] = []
    const t0 = performance.now()
    while (sim.t < 0.5) { const f = await sim.step(); serial += f.serial[b.part.ref]; ma.push((f.avg["I(D1)"] ?? 0) * 1000) }
    sim.dispose()
    console.log(`0.5 s of STM32 + circuit in ${((performance.now() - t0) / 1000).toFixed(1)} s; LED mA per 25 ms frame:`, ma.map((x) => x.toFixed(1)).join(" "))
    // 50 ms on / 50 ms off in 25 ms frames: lit frames ≈ (3.3 − 1.8) / 355 ≈ 4 mA, dark ones ≈ 0
    expect(ma.filter((x) => x > 3.5).length).toBeGreaterThanOrEqual(5)
    expect(ma.filter((x) => x < 0.3).length).toBeGreaterThanOrEqual(5)
    // 10 kΩ to 3.3 V beats the 40 kΩ internal pull-down
    expect(serial).toContain("btn=1")
    expect(serial).not.toContain("btn=0")
  })
})
