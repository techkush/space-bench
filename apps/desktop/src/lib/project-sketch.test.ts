// A circuit's boards keep their sketches as real project files: firmware/<circuit>-<ref>/ holds
// sketch.ino, libraries.txt and board.json; they come back on open (and win over the cache), and the
// project's Arduino libraries are listed from them.
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { describe, expect, it } from "vitest"
import { compileKirk } from "@/kirk/compile"
import { setLoader } from "@/lib/kicad"
import { withLibrary } from "@/mcu/compile"
import { boardSketchFolder, boardSketchLink, createProject, loadCircuit, newCircuit, projectArduinoLibraries, saveCircuit } from "./project"
import { join, memoryFS } from "./projectfs"

const KICAD = path.resolve(import.meta.dirname, "../../public/kicad")
setLoader(async (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(KICAD, `${f}.gz`))).toString()))

describe("board sketches in a project", () => {
  it("save to firmware/<circuit>-<ref>/, open from there, and list the project's libraries", async () => {
    const vfs = memoryFS()
    const p = await createProject(vfs, "/P", "Weather")
    const file = await newCircuit(p, "Station")
    const r = await compileKirk(`circuit Station {
    ground GND
    A1 = lib("MCU_Module:Arduino_UNO_R3")
    A1.6 -- GND
}`)
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    const doc = { ...r.doc!, firmware: { A1: { files: [{ name: "sketch.ino", content: "void setup(){}\nvoid loop(){}\n" }, { name: "util.h", content: "#pragma once\n" }], libraries: "Adafruit BME280 Library\nRTClib\n" } } }
    await saveCircuit(p, file, doc)

    const dir = join(p.root, boardSketchFolder(file, "A1"))
    expect(boardSketchFolder(file, "A1")).toBe("firmware/station-a1")
    expect(await vfs.read(join(dir, "sketch.ino"))).toContain("void setup")
    expect(await vfs.read(join(dir, "libraries.txt"))).toContain("RTClib")
    expect(await boardSketchLink(p, "firmware/station-a1")).toEqual({ circuit: file, ref: "A1", lib: "MCU_Module:Arduino_UNO_R3" })

    // the files are the source of truth: edited on disk, they're what opens
    await vfs.write(join(dir, "sketch.ino"), "// edited outside\nvoid setup(){}\nvoid loop(){}\n")
    const back = await loadCircuit(p, file, undefined)
    expect(back.doc.firmware?.A1.files[0]).toEqual({ name: "sketch.ino", content: "// edited outside\nvoid setup(){}\nvoid loop(){}\n" })
    expect(back.doc.firmware?.A1.files.map((f) => f.name)).toEqual(["sketch.ino", "util.h"])

    // a file removed from the sketch is removed from the folder
    await saveCircuit(p, file, { ...back.doc, firmware: { A1: { files: [back.doc.firmware!.A1.files[0]], libraries: "RTClib\n" } } })
    expect(await vfs.exists(join(dir, "util.h"))).toBe(false)

    // the project's Arduino libraries (Sketch tab, project tree)
    expect(await projectArduinoLibraries(p)).toEqual([{ name: "RTClib", users: ["station-a1"] }])
  })

  it("libraries.txt: add once, remove, keep comments and versions", () => {
    let t = "# what the sketch needs\nRTClib@2.1.4\n"
    t = withLibrary(t, "Adafruit SSD1306", true)
    t = withLibrary(t, "Adafruit SSD1306", true)
    expect(t).toBe("# what the sketch needs\nRTClib@2.1.4\nAdafruit SSD1306\n")
    t = withLibrary(t, "RTClib", false)
    expect(t).toBe("# what the sketch needs\nAdafruit SSD1306\n")
  })
})
