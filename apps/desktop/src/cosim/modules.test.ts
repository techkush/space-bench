// Arduino modules in a schematic: an MPU6050 and an SSD1306 OLED wired to an Uno run inside the
// Uno's emulator next to its real compiled sketch, while ngspice simulates the circuit around.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { describe, expect, it } from "vitest"
import { run } from "../../vite-ngspice"
import { compileKirk } from "@/kirk/compile"
import { remap, type JobResult } from "@/lib/engine"
import { getSymbol, loadSymbol, setLoader } from "@/lib/kicad"
import { allModules } from "@/lib/modules"
import { buildNetlist, type SpiceNetlist } from "@/lib/spice"
import { deriveNetlist } from "@/editor/netlist"
import { boardParts } from "./boards"
import { localChip } from "./chip"
import { CoSim } from "./cosim"
import { boardModules } from "./modules"

const KICAD = path.resolve(import.meta.dirname, "../../public/kicad")
setLoader(async (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(KICAD, `${f}.gz`))).toString()))
const ngspice = ["/opt/homebrew/bin/ngspice", "/usr/local/bin/ngspice", "/usr/bin/ngspice"].find((p) => fs.existsSync(p))
const cli = ["/opt/homebrew/bin/arduino-cli", "/usr/local/bin/arduino-cli"].find((p) => fs.existsSync(p))
const user = process.env.SB_ARDUINO_USER ?? path.join(os.homedir(), ".cache/spacebench-test-libs")
const env = { ...process.env, ARDUINO_DIRECTORIES_USER: user }
const hasOled = !!cli && fs.existsSync(path.join(user, "libraries", "Adafruit_SSD1306"))

function build(code: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbcosimmod-"))
  const sk = path.join(dir, "sketch"); fs.mkdirSync(sk)
  fs.writeFileSync(path.join(sk, "sketch.ino"), code)
  execFileSync(cli!, ["compile", "--fqbn", "arduino:avr:uno", "--output-dir", path.join(dir, "out"), sk], { encoding: "utf8", env })
  return fs.readFileSync(path.join(dir, "out", "sketch.ino.hex"), "utf8")
}
const simulate = async (net: SpiceNetlist): Promise<JobResult> => {
  const r = await run(net.text)
  if (r.status !== 200) throw new Error(`${r.body}\n${net.text}`)
  return remap(JSON.parse(r.body) as JobResult, net)
}
const chipOf = (chip: string) => allModules().find((m) => m.part.model.m === "i2c" && (m.part.model as { chip: string }).chip === chip)!

describe.skipIf(!ngspice || !cli || !hasOled)("Arduino modules in a schematic", { timeout: 300_000 }, () => {
  it("an MPU6050 and an SSD1306 on the Uno's I²C run with its sketch; the slider and the screen reach the schematic", async () => {
    await loadSymbol("MCU_Module:Arduino_UNO_R3")
    const uno = getSymbol("MCU_Module:Arduino_UNO_R3")!.units[0].pins
    const num = (name: string) => uno.find((p) => p.name === name)!.n
    const mpu = chipOf("mpu6050"), oled = chipOf("ssd1306")
    const r = await compileKirk(`circuit Mods {
    ground GND
    A1 = lib("MCU_Module:Arduino_UNO_R3")
    U1 = lib("${mpu.id}")
    U2 = lib("${oled.id}")
    A1.${num("+5V")} -- VCC
    A1.${num("GND")} -- GND
    A1.${num("SDA/A4")} -- SDA
    A1.${num("SCL/A5")} -- SCL
    U1.VCC -- VCC
    U1.GND -- GND
    U1.SDA -- SDA
    U1.SCL -- SCL
    U2.VCC -- VCC
    U2.GND -- GND
    U2.SDA -- SDA
    U2.SCL -- SCL
}
simulate tran(stop: 1 s, step: 1 ms)
`)
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    const doc = r.doc!
    // a plain netlist has the modules (their pins leak to ground, nothing floats)
    expect(buildNetlist(doc, deriveNetlist(doc), "op").issues.filter((i) => i.severity === "error")).toEqual([])
    const [b] = boardParts(doc)
    const mods = boardModules(doc).get(b.part.ref)!
    expect(mods.modules.sort()).toEqual(["U1", "U2"])
    expect(mods.owned.sort()).toEqual(["A4", "A5"])
    const hex = build(`#include <Wire.h>
#include <Adafruit_SSD1306.h>
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
void setup() {
  Serial.begin(115200); Wire.begin();
  Wire.beginTransmission(0x68); Wire.write(0x6B); Wire.write(0); Wire.endTransmission();
  Wire.beginTransmission(0x68); Wire.write(0x75); Wire.endTransmission(false); Wire.requestFrom(0x68, 1);
  Serial.print("WHO "); Serial.println(Wire.read(), HEX);
  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("no oled");
  oled.clearDisplay(); oled.fillRect(0, 0, 64, 32, SSD1306_WHITE); oled.display();
}
void loop() {
  Wire.beginTransmission(0x68); Wire.write(0x3B); Wire.endTransmission(false); Wire.requestFrom(0x68, 2);
  int16_t ax = (Wire.read() << 8) | Wire.read();
  Serial.print("AX "); Serial.println(ax / 16384.0, 2);
  delay(100);
}`)
    const chip = localChip(b.board, hex, mods)
    const sim = new CoSim(doc, [{ ref: b.part.ref, board: b.board, chip }], simulate, { frame: 0.05 })
    let serial = ""
    let last = await sim.step()
    serial += last.serial[b.part.ref]
    while (sim.t < 1) { last = await sim.step(); serial += last.serial[b.part.ref] }
    expect(serial).toContain("WHO 68")
    expect(serial).not.toContain("no oled")
    // the OLED's picture: the filled top-left quarter is lit, the rest dark
    const bm = last.mods.U2?.bitmap
    expect(bm).toBeTruthy()
    const lit = (x: number, y: number) => (bm!.data[y * 16 + (x >> 3)] >> (7 - (x & 7))) & 1
    expect(lit(10, 10)).toBe(1)
    expect(lit(100, 50)).toBe(0)
    // the MPU6050's accelerometer slider from the schematic reaches the sketch
    const key = mpu.ctls.find((c) => /^a?x$/i.test(c.key) || /accel.*x/i.test(c.label))?.key ?? mpu.ctls[0].key
    chip.ui?.("U1", { v: { [key]: 0.5 } })
    serial = ""
    const t0 = sim.t
    while (sim.t < t0 + 0.5) serial += (await sim.step()).serial[b.part.ref]
    expect(serial).toContain("AX 0.50")
    sim.dispose()
  })
})
