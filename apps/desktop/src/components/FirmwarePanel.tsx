// The firmware side of the circuit workspace: the sketch of each board in the schematic,
// compile, run the circuit and the firmware together, and the Serial Monitor.
import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { Cpu, Hammer, Loader2, Play, Square, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import type { Doc, Firmware } from "@/editor/model"
import type { BoardDef } from "@/mcu/boards"
import { firmwareOf, type CoSimControl } from "@/cosim/useCoSim"

const SketchEditor = lazy(() => import("@/mcu/SketchEditor"))

const formatBytes = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} kB` : `${n} B`)

export function FirmwarePanel({ doc, boards, active, setActive, onChange, cosim, dark, onClose }: {
  doc: Doc
  boards: { ref: string; board: BoardDef }[]
  active: string | null
  setActive: (ref: string) => void
  onChange: (ref: string, fw: Firmware) => void
  cosim: CoSimControl
  dark: boolean
  onClose: () => void
}) {
  const cur = boards.find((b) => b.ref === active) ?? boards[0]
  const fw = cur ? firmwareOf(doc, cur.ref, cur.board) : null
  const [file, setFile] = useState("sketch.ino")
  const [bottom, setBottom] = useState<"serial" | "output">("serial")
  const [line, setLine] = useState("")
  const [compiling, setCompiling] = useState(false)
  const serialEnd = useRef<HTMLDivElement>(null)
  const build = cur ? cosim.builds[cur.ref] : undefined
  const serial = cur ? cosim.serial[cur.ref] ?? "" : ""

  useEffect(() => { serialEnd.current?.scrollIntoView({ block: "end" }) }, [serial])
  useEffect(() => { if (build && !build.ok) setBottom("output") }, [build])
  useEffect(() => { setFile("sketch.ino") }, [cur?.ref])

  if (!cur || !fw) return null
  const files = [...fw.files.map((f) => f.name), "libraries.txt"]
  const isLibs = file === "libraries.txt"
  const content = isLibs ? fw.libraries ?? "" : fw.files.find((f) => f.name === file)?.content ?? ""
  const setContent = (v: string) => onChange(cur.ref, isLibs ? { ...fw, libraries: v } : { ...fw, files: fw.files.map((f) => (f.name === file ? { ...f, content: v } : f)) })

  const compileNow = async () => {
    setCompiling(true)
    try { await cosim.compile(cur.ref); setBottom("output") } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setCompiling(false) }
  }
  const status = cosim.status === "running" && cosim.clock
    ? `Running · ${cosim.clock.t.toFixed(2)} s · ${cosim.clock.speed >= 0.995 ? "real time" : `${(cosim.clock.speed * 100).toFixed(0)} % of real time`}`
    : cosim.status === "compiling" || compiling ? "Compiling…"
    : cosim.status === "starting" ? "Starting the chips…"
    : cosim.status === "error" ? cosim.error ?? "Failed"
    : build ? (build.ok ? `Compiled${build.flash ? ` · ${formatBytes(build.flash.used)} of ${formatBytes(build.flash.max)}` : ""}` : "Compile failed")
    : "Not compiled yet"

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <Cpu className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Firmware</span>
        <div className="ml-1 flex min-w-0 gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {boards.map((b) => (
            <button key={b.ref} onClick={() => setActive(b.ref)} title={b.board.name}
              className={`h-7 shrink-0 rounded-md px-2 text-xs ${b.ref === cur.ref ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground"}`}>
              {b.ref} · {b.board.name.replace(/^Arduino /, "").replace(/^Raspberry Pi /, "")}
            </button>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 gap-1.5" disabled={compiling || cosim.active} onClick={compileNow} title="Compile with arduino-cli">
            {compiling ? <Loader2 className="size-3.5 animate-spin" /> : <Hammer className="size-3.5" />} Compile
          </Button>
          {cosim.active
            ? <Button size="sm" variant="destructive" className="h-7 gap-1.5" onClick={cosim.stop} title="Stop the circuit and the firmware"><Square className="size-3.5" /> Stop</Button>
            : <Button size="sm" className="h-7 gap-1.5" onClick={cosim.start} title="Simulate the circuit and run the firmware together"><Play className="size-3.5" /> Run</Button>}
          <button onClick={onClose} title="Close the firmware panel" aria-label="Close the firmware panel"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-4" /></button>
        </div>
      </div>
      <div className={`shrink-0 truncate border-b px-3 py-1 text-xs ${cosim.status === "error" || (build && !build.ok) ? "text-destructive" : "text-muted-foreground"}`} title={status}>
        {(cosim.status === "compiling" || cosim.status === "starting" || compiling) && <Loader2 className="mr-1 inline size-3 animate-spin" />}{status}
      </div>
      <div className="flex shrink-0 gap-1 border-b px-2 py-1">
        {files.map((f) => (
          <button key={f} onClick={() => setFile(f)} className={`h-6 rounded px-2 font-mono text-xs ${f === file ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{f}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading the editor…</div>}>
          <SketchEditor path={`${cur.ref}/${file}`} language={isLibs ? "plaintext" : "cpp"} value={content} onChange={setContent} dark={dark}
            diagnostics={isLibs ? [] : (build?.diagnostics ?? []).filter((d) => d.file === file)} />
        </Suspense>
      </div>
      <div className="flex h-[38%] min-h-[140px] shrink-0 flex-col border-t">
        <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
          {([["serial", "Serial Monitor"], ["output", "Output"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setBottom(k)} className={`h-6 rounded px-2 text-xs ${bottom === k ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
          ))}
          {bottom === "serial" && <button onClick={() => cosim.clearSerial(cur.ref)} className="ml-auto h-6 rounded px-2 text-xs text-muted-foreground hover:text-foreground">Clear</button>}
        </div>
        {bottom === "serial" ? (
          <>
            <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap">
              {serial || <span className="text-muted-foreground">{cosim.active ? "Nothing printed yet." : "Press Run: the sketch's Serial output appears here."}</span>}
              <div ref={serialEnd} />
            </div>
            <form className="flex shrink-0 gap-1 border-t p-1.5" onSubmit={(e) => { e.preventDefault(); if (!line) return; cosim.sendSerial(cur.ref, line + "\n"); setLine("") }}>
              <input value={line} onChange={(e) => setLine(e.target.value)} disabled={cosim.status !== "running"} placeholder={cosim.status === "running" ? `Send to ${cur.ref}…` : "Run to send"}
                className="h-7 min-w-0 flex-1 rounded-md border bg-transparent px-2 font-mono text-xs outline-none focus:border-ring disabled:opacity-50" />
              <Button type="submit" size="sm" variant="outline" className="h-7" disabled={cosim.status !== "running" || !line}>Send</Button>
            </form>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap">
            {build?.diagnostics.filter((d) => d.severity === "error").map((d, i) => (
              <button key={i} className="block text-left text-destructive hover:underline" onClick={() => { setFile(d.file); setTimeout(() => window.dispatchEvent(new CustomEvent("sb-reveal-line", { detail: { ...d, file: `${cur.ref}/${d.file}` } })), 50) }}>
                {d.file}:{d.line}: {d.message}
              </button>
            ))}
            {build ? build.log || "(no output)" : <span className="text-muted-foreground">Compile to see the compiler's output.</span>}
          </div>
        )}
      </div>
    </div>
  )
}
