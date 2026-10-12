// What an Arduino module shows while the schematic simulates, drawn inside its symbol: a display's
// picture (colour image, OLED pixels, LCD text), LED pixels, an 8×8 matrix, a glow — from the
// module running with its board (cosim) — or, for the SPICE-side modules, their state from the
// circuit (an LED module lit by its input, a sensor's reading).
import { memo } from "react"
import type { ModView } from "@/mcu/catalog/look"
import { CHIP_SIDE, moduleControls, type ModuleInfo } from "@/lib/modules"
import type { Part } from "@/editor/model"

/** data: URLs of pictures, by the pixel array (a new array is a new picture) */
const urls = new WeakMap<object, string>()
function pictureUrl(key: object, w: number, h: number, rgba: () => Uint8ClampedArray<ArrayBuffer>): string | null {
  const hit = urls.get(key)
  if (hit) return hit
  if (typeof document === "undefined") return null
  const cv = document.createElement("canvas")
  cv.width = w; cv.height = h
  const ctx = cv.getContext("2d")
  if (!ctx) return null
  ctx.putImageData(new ImageData(rgba(), w, h), 0, 0)
  const url = cv.toDataURL()
  urls.set(key, url)
  return url
}
const bitmapRgba = (b: NonNullable<ModView["bitmap"]>) => () => {
  const out = new Uint8ClampedArray(b.w * b.h * 4)
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const on = b.data[y * (b.w >> 3) + (x >> 3)] & (0x80 >> (x & 7)), i = (y * b.w + x) * 4
    out[i] = on ? 0x9f : 0x0b; out[i + 1] = on ? 0xe8 : 0x10; out[i + 2] = on ? 0xff : 0x20; out[i + 3] = 255
  }
  return out
}
const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`
/** each module's last picture with pixels (by part ref) */
const lastImage = new Map<string, NonNullable<ModView["image"]>>()

export const ModuleLive = memo(function ModuleLive({ m, part, view, values, netOf }: {
  m: ModuleInfo
  part: Part
  /** from the module running with its board (chip-side modules) */
  view: ModView | undefined
  /** the circuit's values (V(net) …) */
  values: Record<string, number>
  /** a module pin's net */
  netOf: (pin: string) => string | undefined
}) {
  const s = m.screen
  const vOf = (pin: string) => { const n = netOf(pin); return n ? values[`V(${n})`] : undefined }
  let v: ModView | undefined = view
  if (!v && !CHIP_SIDE.has(m.part.model.m)) {
    // SPICE-side modules: their state from the circuit
    const mod = m.part.model
    if (mod.m === "led" || mod.m === "buzzer") v = { glow: [(vOf(mod.pin) ?? 0) > 1.5 ? 1 : 0] }
    else if (mod.m === "relay") { const a = vOf(mod.coil[0]) ?? 0, b = mod.coil[1] ? vOf(mod.coil[1]) ?? 0 : 0; v = { glow: [Math.abs(a - b) > (mod.vOn ?? 3) / 2 ? 1 : 0] } }
    else if (mod.m === "motor" || mod.m === "load") v = { glow: [Math.abs((vOf(mod.a) ?? 0) - (mod.b ? vOf(mod.b) ?? 0 : 0)) > 1 ? 1 : 0] }
    else if (mod.m === "analog" || mod.m === "lres") {
      const c = mod.ctl, val = moduleControls(m, part.sim?.Params)[c.key]
      v = { text: `${c.label.replace(/\s*\(.*\)$/, "")} ${Number(val.toPrecision(4))} ${c.unit}`.trim() }
    } else if (mod.m === "digital" || mod.m === "button") v = { glow: [/(^|\s)(pressed|active)=1(\s|$)/.test(part.sim?.Params ?? "") ? 1 : 0] }
  }
  if (!v) return null
  // frames carry a screen's pixels only when the picture changed: keep the last ones
  if (v.image) {
    if (v.image.data) lastImage.set(part.ref, v.image)
    else { const kept = lastImage.get(part.ref); if (kept?.ver === v.image.ver) v = { ...v, image: kept } }
  }
  const out: React.ReactNode[] = []
  if (v.image?.data) {
    const im = v.image
    const url = pictureUrl(im.data!, im.w, im.h, () => new Uint8ClampedArray(im.data!))
    if (url) out.push(<image key="img" x={s.x} y={s.y} width={s.w} height={s.h} href={url} preserveAspectRatio="none" style={{ imageRendering: "pixelated" }} />)
  } else if (v.bitmap) {
    const url = pictureUrl(v.bitmap.data, v.bitmap.w, v.bitmap.h, bitmapRgba(v.bitmap))
    if (url) out.push(<image key="bm" x={s.x} y={s.y} width={s.w} height={s.h} href={url} preserveAspectRatio="none" style={{ imageRendering: "pixelated" }} />)
  } else if (v.text !== undefined) {
    const lines = v.text.split("\n")
    const size = Math.min(8, (s.h - 2) / Math.max(1, lines.length), (s.w / Math.max(1, ...lines.map((l) => l.length))) * 1.6)
    if (m.display) out.push(<rect key="bg" x={s.x} y={s.y} width={s.w} height={s.h} fill={v.glow?.[0] ? "#1e3a8a" : "#0b1020"} rx={1.5} />)
    lines.forEach((l, i) => out.push(
      <text key={`t${i}`} x={s.x + 2} y={s.y + (i + 1) * size + (m.display ? 1 : 0)} fontSize={size} fill={m.display ? "#c7f9ff" : "currentColor"} fontFamily="ui-monospace,monospace" style={{ whiteSpace: "pre" }}>{l}</text>,
    ))
  } else if (v.pix?.length) {
    const n = v.pix.length, cols = Math.min(n, n === 64 ? 8 : 16), rows = Math.ceil(n / cols)
    const d = Math.min(s.w / cols, (m.display ? s.h : 12) / rows)
    v.pix.forEach((c, i) => out.push(<circle key={`p${i}`} cx={s.x + (i % cols) * d + d / 2} cy={s.y + Math.floor(i / cols) * d + d / 2} r={d * 0.4} fill={c[0] + c[1] + c[2] ? rgb(c) : "#333"} />))
  } else if (v.rows) {
    const d = Math.min(s.w, s.h) / 8
    for (let r = 0; r < 8; r++) for (let col = 0; col < 8; col++) out.push(<circle key={`r${r}${col}`} cx={s.x + col * d + d / 2} cy={s.y + r * d + d / 2} r={d * 0.38} fill={(v.rows[r] ?? 0) & (1 << col) ? "#ff2a2a" : "#3a0d0d"} />)
  }
  // an indicator: something on (an LED, a relay, a radio sending)
  const g = Math.max(v.glow?.[0] ?? 0, v.on ?? 0)
  if (g > 0.03 && !(v.text !== undefined && m.display)) out.push(<circle key="glow" cx={s.x + s.w - 5} cy={s.y + (m.display ? -6 : 6)} r={4} fill="#ff3b3b" fillOpacity={0.35 + 0.65 * g} />)
  return <g className="pointer-events-none">{out}</g>
})
