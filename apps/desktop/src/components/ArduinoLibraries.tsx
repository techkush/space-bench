// A board's Arduino libraries: what its libraries.txt lists (installed or not yet), and the
// Library Manager index to add more. Listed libraries install with arduino-cli on the next compile.
import { Check, Library, Loader2, Plus, Search, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { installedLibraries, parseLibraries, searchLibraries, withLibrary, type ArduinoLib } from "@/mcu/compile"

/** installed libraries, shared by every pane (arduino-cli is slow to list) */
let installedCache: Promise<ArduinoLib[]> | null = null
export const refreshInstalledLibraries = () => { installedCache = null }

export function ArduinoLibraries({ boardRef, text, onChange, cliPath }: { boardRef: string; text: string; onChange: (text: string) => void; cliPath?: string }) {
  const wanted = useMemo(() => parseLibraries(text), [text])
  const [installed, setInstalled] = useState<ArduinoLib[] | null>(null)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ArduinoLib[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    installedCache ??= installedLibraries(cliPath).catch(() => [])
    void installedCache.then(setInstalled)
  }, [cliPath])
  // search the index as you type (debounced)
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults(null); return }
    let live = true
    setBusy(true); setError(null)
    const t = setTimeout(() => {
      searchLibraries(q, cliPath).then((r) => { if (live) setResults(r) }).catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)) }).finally(() => { if (live) setBusy(false) })
    }, 350)
    return () => { live = false; clearTimeout(t) }
  }, [query, cliPath])

  const inst = (name: string) => installed?.find((l) => l.name.toLowerCase() === name.split("@")[0].trim().toLowerCase())
  const listed = (name: string) => wanted.some((w) => w.split("@")[0].trim().toLowerCase() === name.toLowerCase())

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-sm font-medium"><Library className="size-4 text-muted-foreground" /> Arduino libraries <span className="font-mono text-xs text-muted-foreground">{boardRef}</span></div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex flex-col gap-1 p-2">
          {!wanted.length && <p className="px-1 py-2 text-xs text-muted-foreground">No libraries yet. Built-in ones (Wire, SPI, EEPROM, SoftwareSerial, Servo …) need nothing here.</p>}
          {wanted.map((w) => {
            const i = inst(w)
            return (
              <div key={w} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{w}</div>
                  <div className="truncate text-muted-foreground">{i ? `installed ${i.version}${i.sentence ? ` · ${i.sentence}` : ""}` : installed ? "installs on the next compile" : "…"}</div>
                </div>
                {i && <Check className="size-3.5 shrink-0 text-success" />}
                <button title={`Remove ${w}`} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => onChange(withLibrary(text, w.split("@")[0].trim(), false))}><X className="size-3.5" /></button>
              </div>
            )
          })}
        </div>
        <div className="border-t p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add a library (Library Manager)…" className="h-8 pl-7 text-xs" />
            {busy && <Loader2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          <div className="mt-2 flex flex-col gap-1">
            {results?.map((l) => (
              <div key={l.name} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent/60">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{l.name} <span className="font-normal text-muted-foreground">{l.version}</span></div>
                  <div className="truncate text-muted-foreground" title={l.sentence}>{l.sentence}</div>
                </div>
                {listed(l.name)
                  ? <Check className="size-3.5 shrink-0 text-success" />
                  : <button title={`Add ${l.name}`} className="flex items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-background" onClick={() => onChange(withLibrary(text, l.name, true))}><Plus className="size-3" /> Add</button>}
              </div>
            ))}
            {results && !results.length && <p className="px-1 text-xs text-muted-foreground">No library matches.</p>}
          </div>
        </div>
      </div>
      <p className="shrink-0 border-t px-3 py-2 text-[11px] text-muted-foreground">Listed libraries install with arduino-cli on the next compile (into your Arduino sketchbook).</p>
    </div>
  )
}
