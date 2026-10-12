// Compile a sketch: arduino-cli through the Tauri command (desktop) or the dev server (browser).
import { invoke, isTauri } from "@tauri-apps/api/core"

export interface SketchFile { name: string; content: string }
export interface Diagnostic { file: string; line: number; col: number; severity: "error" | "warning" | "note"; message: string }
export interface CompileOutput { ok: boolean; hex: string | null; bin: Uint8Array | null; /** ESP32: the flash image's path on disk */ image: string | null; /** the ELF's path on disk (Renode boards boot it) */ elf: string | null; log: string; diagnostics: Diagnostic[]; flash?: { used: number; max: number }; ram?: { used: number; max: number } }
export interface CliStatus { path: string; version: string; cores: string[] }

const devServer = !isTauri() && import.meta.env.DEV

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error ?? r.statusText)
  return j as T
}

export async function cliStatus(bin?: string): Promise<CliStatus> {
  if (isTauri()) return invoke<CliStatus>("arduino_status", { bin: bin || null })
  if (!devServer) throw new Error("Compiling needs the desktop app (or the dev server) with arduino-cli")
  const r = await fetch("/api/arduino")
  const j = await r.json()
  if (!r.ok) throw new Error(j.error)
  return j
}

export async function installCore(core: string, bin?: string, url?: string): Promise<void> {
  if (isTauri()) { await invoke("arduino_install_core", { core, url: url || null, bin: bin || null }); return }
  await post("/api/arduino/core", { core, url })
}

/** A library in the Arduino index or installed: its name, latest / installed version and a sentence. */
export interface ArduinoLib { name: string; version: string; sentence: string; author?: string }

async function libsJson(q: string | null, bin?: string): Promise<unknown> {
  if (isTauri()) return JSON.parse((await invoke<string>(q !== null ? "arduino_lib_search" : "arduino_lib_list", q !== null ? { query: q, bin: bin || null } : { bin: bin || null })) || "{}")
  if (!devServer) throw new Error("Library search needs the desktop app (or the dev server) with arduino-cli")
  const r = await fetch(`/api/arduino/libs${q !== null ? `?q=${encodeURIComponent(q)}` : ""}`)
  const j = await r.json()
  if (!r.ok) throw new Error(j.error ?? r.statusText)
  return j
}

/** Search the Arduino library index (Library Manager): best matches first. */
export async function searchLibraries(query: string, bin?: string, limit = 30): Promise<ArduinoLib[]> {
  const j = (await libsJson(query, bin)) as { libraries?: { name: string; latest?: { version?: string; sentence?: string; author?: string }; releases?: Record<string, { version?: string; sentence?: string; author?: string }> }[] }
  const q = query.toLowerCase()
  const out = (j.libraries ?? []).map((l) => {
    const rel = l.latest ?? Object.values(l.releases ?? {}).pop() ?? {}
    return { name: l.name, version: rel.version ?? "", sentence: rel.sentence ?? "", author: rel.author }
  })
  // exact and prefix matches of the name first
  const rank = (l: ArduinoLib) => (l.name.toLowerCase() === q ? 0 : l.name.toLowerCase().startsWith(q) ? 1 : l.name.toLowerCase().includes(q) ? 2 : 3)
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, limit)
}

/** The libraries installed in arduino-cli's sketchbook. */
export async function installedLibraries(bin?: string): Promise<ArduinoLib[]> {
  const j = (await libsJson(null, bin)) as { installed_libraries?: { library: { name: string; version?: string; sentence?: string; author?: string } }[] }
  return (j.installed_libraries ?? []).map((x) => ({ name: x.library.name, version: x.library.version ?? "", sentence: x.library.sentence ?? "", author: x.library.author }))
}

/** libraries.txt with a library added (once) or removed. */
export function withLibrary(text: string, name: string, add: boolean): string {
  const lines = (text ?? "").split(/\r?\n/)
  const bare = (l: string) => l.replace(/#.*/, "").trim().split("@")[0].trim().toLowerCase()
  const kept = lines.filter((l) => bare(l) !== name.toLowerCase())
  const body = kept.join("\n").replace(/\n+$/, "")
  return add ? `${body ? `${body}\n` : ""}${name}\n` : body ? `${body}\n` : ""
}

/** The board's core (arduino:avr) from its FQBN. */
export const coreOf = (fqbn: string) => fqbn.split(":").slice(0, 2).join(":")

/** libraries.txt: one library per line (Name or Name@version), # comments. */
export const parseLibraries = (text: string) => text.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean)

export async function compileSketch(files: SketchFile[], fqbn: string, libraries: string[], bin?: string, props: string[] = []): Promise<CompileOutput> {
  type Raw = { ok: boolean; hex: string | null; bin?: string | null; image?: string | null; elf?: string | null; stdout: string; stderr: string; sketch_dir: string }
  const raw: Raw = isTauri()
    ? await invoke<Raw>("arduino_compile", { files, fqbn, libraries, props, bin: bin || null })
    : devServer ? await post<Raw>("/api/arduino/compile", { files, fqbn, libraries, props })
    : (() => { throw new Error("Compiling needs the desktop app (or the dev server) with arduino-cli") })()
  const mainName = files.find((f) => f.name.endsWith(".ino"))?.name ?? "sketch.ino"
  // macOS reports the temp folder both as /var/… and /private/var/…
  const dir = raw.sketch_dir.replace(/^\/private\//, "/")
  const log = (raw.stdout + "\n" + raw.stderr).replaceAll(`/private${dir}/`, "").replaceAll(`${dir}/`, "").replaceAll("sketch.ino", mainName).trim()
  const image = raw.bin ? Uint8Array.from(atob(raw.bin), (c) => c.charCodeAt(0)) : null
  return { ok: raw.ok, hex: raw.hex, bin: image, image: raw.image ?? null, elf: raw.elf ?? null, log, diagnostics: parseDiagnostics(log), ...usage(raw.stdout) }
}

/** gcc diagnostics: "sketch.ino:12:5: error: 'x' was not declared in this scope" */
export function parseDiagnostics(log: string): Diagnostic[] {
  const out: Diagnostic[] = []
  const re = /^([^\s:][^:\n]*\.(?:ino|cpp|c|h|hpp)):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.+)$/gm
  for (const m of log.matchAll(re)) out.push({ file: m[1].split("/").pop()!, line: Number(m[2]), col: Number(m[3] ?? 1), severity: m[4] === "fatal error" ? "error" : (m[4] as Diagnostic["severity"]), message: m[5] })
  return out
}

function usage(stdout: string) {
  const f = /Sketch uses (\d+) bytes .*?Maximum is (\d+) bytes/.exec(stdout)
  const r = /Global variables use (\d+) bytes .*?Maximum is (\d+) bytes/.exec(stdout)
  return { flash: f ? { used: +f[1], max: +f[2] } : undefined, ram: r ? { used: +r[1], max: +r[2] } : undefined }
}
