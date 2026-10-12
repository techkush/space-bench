// The Sketch tab (Sketch | Schematic | PCB): the firmware of the circuit's boards, full size — files,
// compile, run with the circuit, Serial — and each board's Arduino libraries beside it.
import { Cpu } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { CoSimControl } from "@/cosim/useCoSim"
import { firmwareOf } from "@/cosim/useCoSim"
import type { Doc, Firmware } from "@/editor/model"
import type { BoardDef } from "@/mcu/boards"
import { ArduinoLibraries } from "./ArduinoLibraries"
import { FirmwarePanel } from "./FirmwarePanel"

/** boards to start from when the circuit has none (KiCad symbols) */
const STARTERS: [string, string][] = [
  ["MCU_Module:Arduino_UNO_R3", "Arduino UNO"], ["MCU_Module:Arduino_Nano_v3.x", "Arduino Nano"],
  ["MCU_Module:Arduino_2560_Pro_Mini", "Arduino Mega"], ["MCU_Module:RaspberryPi_Pico", "Raspberry Pi Pico"],
]

export function SketchView({ doc, boards, active, setActive, onChange, cosim, dark, cliPath, onAskAi, onBack, onAddBoard }: {
  doc: Doc
  boards: { ref: string; board: BoardDef }[]
  active: string | null
  setActive: (ref: string) => void
  onChange: (ref: string, fw: Firmware) => void
  cosim: CoSimControl
  dark: boolean
  cliPath?: string
  onAskAi?: (text: string) => void
  /** back to the schematic */
  onBack: () => void
  /** place a board (symbol id) in the schematic */
  onAddBoard: (lib: string) => void
}) {
  if (!boards.length) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <Cpu className="size-10 text-muted-foreground" />
          <div className="text-lg font-medium">No board runs a sketch in this circuit yet</div>
          <p className="text-sm text-muted-foreground">Place a board in the schematic: its sketch is written here, runs with the circuit (its pins drive the parts, the parts' voltages are what it reads), and its libraries are listed beside it.</p>
          <div className="flex flex-wrap justify-center gap-2">
            {STARTERS.map(([lib, name]) => <Button key={lib} variant="outline" size="sm" onClick={() => onAddBoard(lib)}>{name}</Button>)}
          </div>
        </div>
      </div>
    )
  }
  const cur = boards.find((b) => b.ref === active) ?? boards[0]
  const fw = firmwareOf(doc, cur.ref, cur.board)
  const linux = cur.board.chip === "linux"
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <FirmwarePanel doc={doc} boards={boards} active={cur.ref} setActive={setActive} onChange={onChange} cosim={cosim} dark={dark} onClose={onBack} onAskAi={onAskAi} />
      </div>
      {!linux && (
        <aside className="flex w-80 shrink-0 flex-col border-l bg-background">
          <ArduinoLibraries boardRef={cur.ref} text={fw.libraries ?? ""} cliPath={cliPath} onChange={(libraries) => onChange(cur.ref, { ...fw, libraries })} />
        </aside>
      )}
    </div>
  )
}
