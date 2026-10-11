// Monaco for sketch files: one model per file (its own undo history), compiler errors as markers.
import { useEffect, useRef } from "react"
import Editor, { type OnMount } from "@monaco-editor/react"
import { monaco, setupArduino } from "./monaco"
import type { Diagnostic } from "./compile"

setupArduino()

export default function SketchEditor({ path, language, value, onChange, dark, diagnostics }: { path: string; language: string; value: string; onChange: (v: string) => void; dark: boolean; diagnostics: Diagnostic[] }) {
  const ed = useRef<Parameters<OnMount>[0] | null>(null)
  useEffect(() => {
    const model = ed.current?.getModel()
    if (!model) return
    monaco.editor.setModelMarkers(model, "arduino-cli", diagnostics.map((d) => ({
      startLineNumber: d.line, endLineNumber: d.line, startColumn: d.col, endColumn: model.getLineMaxColumn(Math.min(d.line, model.getLineCount())),
      message: d.message, severity: d.severity === "error" ? monaco.MarkerSeverity.Error : d.severity === "warning" ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
    })))
  }, [diagnostics, path])
  useEffect(() => {
    const go = (e: Event) => {
      const d = (e as CustomEvent<Diagnostic>).detail
      if (d.file !== path || !ed.current) return
      ed.current.revealLineInCenter(d.line)
      ed.current.setPosition({ lineNumber: d.line, column: d.col })
      ed.current.focus()
    }
    window.addEventListener("sb-reveal-line", go)
    return () => window.removeEventListener("sb-reveal-line", go)
  }, [path])
  return (
    <Editor
      path={path}
      language={language}
      value={value}
      theme={dark ? "sb-dark" : "sb-light"}
      onChange={(v) => onChange(v ?? "")}
      onMount={(e) => { ed.current = e }}
      options={{
        fontFamily: "'Geist Mono Variable', ui-monospace, monospace", fontSize: 13, lineHeight: 20, minimap: { enabled: true, scale: 1 },
        scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, renderLineHighlight: "line", padding: { top: 8 }, wordWrap: "on",
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      }}
    />
  )
}
