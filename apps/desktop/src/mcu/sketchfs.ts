// Microcontroller sketches in a project folder: firmware/<name>/ holds the sketch files,
// diagram.json (the wiring, Wokwi format) and libraries.txt.
import type { Project } from "@/lib/project"
import { safeName } from "@/lib/project"
import { baseName, join } from "@/lib/projectfs"
import { diagramText, emptyDiagram, parseDiagram } from "./diagram"
import { blankSketch, type SketchFileData } from "./examples"
import { boardsOf } from "./multiboard"
import type { SketchDoc } from "./McuWorkspace"

const SOURCE = /\.(ino|h|hpp|c|cpp|txt)$/

/** The folder (relative) of the sketch a file belongs to: firmware/<name>/… → firmware/<name>. */
export const sketchFolderOf = (relPath: string) => { const m = /^(firmware\/[^/]+)(\/|$)/.exec(relPath); return m ? m[1] : null }

export async function loadSketch(p: Project, folder: string): Promise<SketchDoc> {
  const dir = join(p.root, folder)
  const entries = (await p.fs.list(dir)).filter((e) => !e.dir)
  const files: SketchFileData[] = []
  for (const e of entries) if (SOURCE.test(e.name)) files.push({ name: e.name, content: await p.fs.read(e.path) })
  // the main .ino first (sketch.ino, or the one named after the folder), libraries.txt last
  const main = files.find((f) => f.name === "sketch.ino") ?? files.find((f) => f.name === `${baseName(folder)}.ino`) ?? files.find((f) => f.name.endsWith(".ino"))
  if (!main) throw new Error(`${folder} has no .ino sketch`)
  files.sort((a, b) => (a === main ? -1 : b === main ? 1 : a.name === "libraries.txt" ? 1 : b.name === "libraries.txt" ? -1 : a.name.localeCompare(b.name)))
  if (!files.some((f) => f.name === "libraries.txt")) files.push({ name: "libraries.txt", content: "" })
  const dj = entries.find((e) => e.name === "diagram.json")
  const diagram = dj ? parseDiagram(await p.fs.read(dj.path)) : emptyDiagram()
  // the other boards' sketches: one folder per board, named after its id
  for (const b of boardsOf(diagram).slice(1)) {
    const sub = join(dir, b.id)
    if (!(await p.fs.exists(sub))) continue
    const own: SketchFileData[] = []
    for (const e of await p.fs.list(sub)) if (!e.dir && SOURCE.test(e.name)) own.push({ name: e.name, content: await p.fs.read(e.path) })
    own.sort((a, c) => (a.name === "sketch.ino" ? -1 : c.name === "sketch.ino" ? 1 : a.name === "libraries.txt" ? 1 : c.name === "libraries.txt" ? -1 : a.name.localeCompare(c.name)))
    files.push(...own.map((f) => ({ ...f, name: `${b.id}/${f.name}` })))
  }
  return { name: baseName(folder), files, diagram }
}

export async function saveSketch(p: Project, folder: string, doc: SketchDoc): Promise<void> {
  const dir = join(p.root, folder)
  await p.fs.mkdir(dir)
  // top-level files are the first board's; "<id>/…" files go in that board's folder. Files of
  // boards no longer on the canvas aren't written (their folder on disk is left alone).
  const folders = ["", ...boardsOf(doc.diagram).slice(1).map((b) => `${b.id}/`)]
  for (const pre of folders) {
    const own = doc.files.filter((f) => (pre ? f.name.startsWith(pre) && !f.name.slice(pre.length).includes("/") : !f.name.includes("/")))
    const sub = pre ? join(dir, pre.slice(0, -1)) : dir
    if (pre) { if (!own.length) continue; await p.fs.mkdir(sub) }
    const keep = new Set(own.map((f) => f.name.slice(pre.length)))
    for (const e of await p.fs.list(sub)) if (!e.dir && SOURCE.test(e.name) && !keep.has(e.name)) await p.fs.remove(e.path)
    for (const f of own) await p.fs.write(join(sub, f.name.slice(pre.length)), f.content)
  }
  await p.fs.write(join(dir, "diagram.json"), diagramText(doc.diagram))
}

/** A new sketch folder in firmware/ (blank, or from an example's files and diagram). */
export async function newSketch(p: Project, name: string, from?: SketchDoc): Promise<string> {
  let base = safeName(name).replace(/\s+/g, "-").toLowerCase(), folder = `firmware/${base}`
  for (let i = 2; await p.fs.exists(join(p.root, folder)); i++) folder = `firmware/${base}-${i}`
  const blank = blankSketch()
  await saveSketch(p, folder, from ?? { name: base, files: blank.files, diagram: blank.diagram })
  return folder
}
