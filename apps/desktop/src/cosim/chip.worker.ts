// A co-simulated chip off the UI thread: one worker per board, driven frame by frame.
import { boardByType } from "@/mcu/boards"
import { ChipRunner, type ChipModules, type FrameIn, type FrameOut, type ModuleUi } from "./chip"

export type ToChip =
  | { type: "start"; board: string; firmware: string | Uint8Array; modules?: ChipModules }
  | { type: "ui"; part: string; u: ModuleUi }
  | { type: "frame"; id: number; frame: FrameIn }
  | { type: "serial"; text: string }
export type FromChip =
  | { type: "ready" }
  | { type: "frame"; id: number; out: FrameOut }
  | { type: "error"; id?: number; message: string }

let runner: ChipRunner | null = null
const post = (m: FromChip) => (self as unknown as Worker).postMessage(m)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

self.onmessage = (e: MessageEvent<ToChip>) => {
  const m = e.data
  if (m.type === "start") {
    try {
      const board = boardByType(m.board)
      if (!board) throw new Error(`unknown board ${m.board}`)
      runner = new ChipRunner(board, m.firmware, m.modules)
      post({ type: "ready" })
    } catch (err) { post({ type: "error", message: message(err) }) }
  } else if (m.type === "frame") {
    if (!runner) { post({ type: "error", id: m.id, message: "the chip isn't running" }); return }
    try { post({ type: "frame", id: m.id, out: runner.frame(m.frame) }) } catch (err) { post({ type: "error", id: m.id, message: message(err) }) }
  } else if (m.type === "serial") runner?.serialWrite(m.text)
  else if (m.type === "ui") runner?.ui(m.part, m.u)
}
