// An Arduino module's live controls in the inspector: its sliders (temperature, distance …), a
// press button and an on switch. They are stored in the part's Sim.Params, so they are saved with
// the schematic, and a running simulation picks them up from the next frame.
import { Hand } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import type { Part } from "@/editor/model"
import { CHIP_SIDE, moduleControls, moduleOf } from "@/lib/modules"

/** models whose part is pressed / switched on (a button, a PIR, a card reader, a voice command …) */
const PRESS = new Set(["button", "digital"])

export function ModuleControls({ part, params, setParams }: { part: Part; params: Record<string, string>; setParams: (p: Record<string, string>) => void }) {
  const m = moduleOf(part.lib)
  if (!m) return null
  const values = moduleControls(m, part.sim?.Params)
  const kind = m.part.model.m
  const chipSide = CHIP_SIDE.has(kind)
  const press = PRESS.has(kind) || chipSide
  const fmt = (v: number, step: number) => (step >= 1 ? String(Math.round(v)) : v.toFixed(Math.min(3, Math.max(0, -Math.floor(Math.log10(step))))))
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium">Arduino module</div>
      <p className="text-xs text-muted-foreground">{m.part.hint}</p>
      {chipSide && <p className="text-xs text-muted-foreground">Runs inside the board it is wired to (its sketch talks to it), while the circuit simulates.</p>}
      {m.ctls.map((c) => (
        <div key={c.key} className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{c.label} · {fmt(values[c.key], c.step)} {c.unit}</span>
          <Slider value={[values[c.key]]} min={c.min} max={c.max} step={c.step} onValueChange={([v]) => setParams({ [c.key.toLowerCase()]: fmt(v, c.step) })} />
        </div>
      ))}
      {press && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="flex-1 select-none"
            onPointerDown={() => setParams({ pressed: "1" })} onPointerUp={() => setParams({ pressed: "0" })} onPointerLeave={() => params.pressed === "1" && setParams({ pressed: "0" })}>
            <Hand /> Press (hold)
          </Button>
          <label className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
            On <Switch checked={params.active === "1"} onCheckedChange={(on) => setParams({ active: on ? "1" : "0" })} />
          </label>
        </div>
      )}
    </div>
  )
}
