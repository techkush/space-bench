// The open project's files, in the workspace's left sidebar: circuits open in the workspace,
// library files in the library editor; new circuits and libraries are one click away.
import { useState } from "react"
import { BookOpen, ChevronDown, ChevronRight, CircuitBoard, Cpu, FileCode2, FileText, Folder, FolderOpen, Library, MoreHorizontal, Plus, RefreshCw, Sigma, Spline } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { Project, TreeNode } from "@/lib/project"
import { rel } from "@/lib/project"
import { cn } from "@/lib/utils"

const FOLDER_ICON: Record<string, typeof Folder> = { circuits: Spline, firmware: Cpu, lib: Library, pcb: CircuitBoard, models: FileText, results: Sigma }
const FOLDER_LABEL: Record<string, string> = { circuits: "Circuits", firmware: "Firmware", lib: "Libraries", pcb: "Boards", models: "Models", results: "Results" }

export function ProjectPanel({ project, tree, active, dirty, onOpen, onNewCircuit, onNewLibrary, onNewSketch, onRefresh, onReveal, onClose, arduinoLibs, onArduinoLib }: {
  project: Project
  tree: TreeNode[]
  /** the file open in the workspace (relative) */
  active: string | null
  dirty: boolean
  onOpen: (relPath: string) => void
  onNewCircuit: () => void
  onNewLibrary: () => void
  onNewSketch: () => void
  onRefresh: () => void
  onReveal: ((relPath: string) => void) | null
  onClose: () => void
  /** every Arduino library the project's sketches use, and which sketches use it */
  arduinoLibs?: { name: string; users: string[] }[]
  /** a library clicked: show the sketch that uses it (the Sketch tab) */
  onArduinoLib?: (name: string, users: string[]) => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ circuits: true, lib: true, arduino: true })
  const top = tree.filter((n) => n.dir).sort((a, b) => order(a.name) - order(b.name))
  const files = tree.filter((n) => !n.dir)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" title={project.root}>{project.manifest.name}</div>
          {project.manifest.description && <div className="truncate text-[11px] text-muted-foreground">{project.manifest.description}</div>}
        </div>
        <Button variant="ghost" size="icon-sm" title="Refresh" onClick={onRefresh}><RefreshCw /></Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" title="Project"><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onNewCircuit}><Spline /> New circuit…</DropdownMenuItem>
            <DropdownMenuItem onClick={onNewLibrary}><Library /> New component library…</DropdownMenuItem>
            <DropdownMenuItem onClick={onNewSketch}><Cpu /> New Arduino sketch…</DropdownMenuItem>
            {onReveal && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => onReveal("")}><FolderOpen /> Show in Finder</DropdownMenuItem></>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onClose}>Close project</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1 text-[13px]">
        {top.map((d) => {
          const Icon = FOLDER_ICON[d.name] ?? Folder
          const isOpen = open[d.name] ?? false
          const add = d.name === "circuits" ? onNewCircuit : d.name === "lib" ? onNewLibrary : d.name === "firmware" ? onNewSketch : null
          return (
            <div key={d.path}>
              <div className="group flex items-center gap-1 px-2 py-1 hover:bg-accent/60">
                <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => setOpen((o) => ({ ...o, [d.name]: !isOpen }))}>
                  {isOpen ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="truncate font-medium">{FOLDER_LABEL[d.name] ?? d.name}</span>
                  <span className="text-[11px] text-muted-foreground">{countFiles(d)}</span>
                </button>
                {add && <button className="invisible rounded p-0.5 text-muted-foreground hover:text-foreground group-hover:visible" title={d.name === "circuits" ? "New circuit" : d.name === "firmware" ? "New sketch" : "New library"} onClick={add}><Plus className="size-3.5" /></button>}
              </div>
              {isOpen && <Files nodes={d.children ?? []} depth={1} project={project} active={active} dirty={dirty} onOpen={onOpen} onReveal={onReveal} />}
              {isOpen && !(d.children ?? []).length && <div className="py-1 pl-9 text-[11px] text-muted-foreground">empty</div>}
            </div>
          )
        })}
        {arduinoLibs && (
          <div>
            <div className="group flex items-center gap-1 px-2 py-1 hover:bg-accent/60">
              <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => setOpen((o) => ({ ...o, arduino: !o.arduino }))} title="The Arduino libraries the project's sketches use (their libraries.txt)">
                {open.arduino ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
                <BookOpen className="size-4 text-muted-foreground" />
                <span className="truncate font-medium">Arduino libraries</span>
                <span className="text-[11px] text-muted-foreground">{arduinoLibs.length}</span>
              </button>
            </div>
            {open.arduino && arduinoLibs.map((l) => (
              <button key={l.name} onClick={() => onArduinoLib?.(l.name, l.users)} title={`Used by ${l.users.join(", ")}`}
                className="flex w-full items-center gap-1.5 py-1 pr-2 text-left hover:bg-accent/60" style={{ paddingLeft: 28 }}>
                <Library className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{l.name}</span>
                <span className="ml-auto shrink-0 truncate font-mono text-[10px] text-muted-foreground">{l.users.join(", ")}</span>
              </button>
            ))}
            {open.arduino && !arduinoLibs.length && <div className="py-1 pl-9 text-[11px] text-muted-foreground">none yet — add them in the Sketch tab</div>}
          </div>
        )}
        <Files nodes={files} depth={0} project={project} active={active} dirty={dirty} onOpen={onOpen} onReveal={onReveal} />
      </div>
      <div className="border-t px-3 py-1.5 font-mono text-[10px] text-muted-foreground" title={project.root}>{project.root}</div>
    </div>
  )
}

const order = (n: string) => ["circuits", "firmware", "lib", "pcb", "models", "results"].indexOf(n) + 1 || 99
const countFiles = (n: TreeNode): number => (n.children ?? []).reduce((s, c) => s + (c.dir ? countFiles(c) : 1), 0)

function Files({ nodes, depth, project, active, dirty, onOpen, onReveal }: { nodes: TreeNode[]; depth: number; project: Project; active: string | null; dirty: boolean; onOpen: (r: string) => void; onReveal: ((r: string) => void) | null }) {
  return (
    <>
      {nodes.map((n) => {
        const r = rel(project, n.path)
        if (n.dir) return (
          <div key={n.path}>
            <div className="flex items-center gap-1.5 py-1 text-muted-foreground" style={{ paddingLeft: 12 + depth * 16 }}><Folder className="size-3.5" /> {n.name}</div>
            <Files nodes={n.children ?? []} depth={depth + 1} project={project} active={active} dirty={dirty} onOpen={onOpen} onReveal={onReveal} />
          </div>
        )
        const kirk = n.name.endsWith(".kirk") || (r.startsWith("firmware/") && /\.(ino|h|cpp|json|txt|py)$/.test(n.name))
        const isActive = r === active
        return (
          <button key={n.path} onClick={() => (kirk ? onOpen(r) : onReveal?.(r))} title={kirk ? `Open ${r}` : onReveal ? "Show in Finder" : r}
            className={cn("flex w-full items-center gap-1.5 py-1 pr-2 text-left hover:bg-accent/60", isActive && "bg-accent font-medium")} style={{ paddingLeft: 12 + depth * 16 }}>
            {kirk ? <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className="truncate">{n.name}</span>
            {isActive && dirty && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-warning" title="Unsaved changes" />}
          </button>
        )
      })}
    </>
  )
}
