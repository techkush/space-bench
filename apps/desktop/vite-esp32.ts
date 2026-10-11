// Dev-only: the browser build's stand-in for the Tauri esp32_* commands (src-tauri/src/esp32.rs).
//   GET  /api/esp32            → "version · path" (404 when QEMU is missing)
//   POST /api/esp32/start      { image }        POST /api/esp32/stop
//   GET  /api/esp32/poll       → { serial, bridge: number[], running, log }
//   POST /api/esp32/send       { serial?, bridge?: number[] }
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import type { Plugin } from "vite"

function findQemu(): string | null {
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin"]
  for (const root of [path.join(os.homedir(), ".espressif/tools/qemu-xtensa"), path.join(os.homedir(), "Library/Application Support/Space Bench/qemu-xtensa")]) {
    try { for (const v of fs.readdirSync(root).sort().reverse()) dirs.push(path.join(root, v, "qemu/bin")) } catch { /* none */ }
  }
  for (const d of dirs) { const p = path.join(d, "qemu-system-xtensa"); try { fs.accessSync(p, fs.constants.X_OK); return p } catch { /* next */ } }
  return null
}

let session: { child: ChildProcess; sock: net.Socket | null; serial: string; bridge: number[]; log: string; running: boolean } | null = null
const stop = () => { if (session) { session.child.kill("SIGKILL"); session.sock?.destroy(); session = null } } // QEMU ignores SIGTERM while its stdio is blocked
const freePort = () => new Promise<number>((ok) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)) }) })

export function esp32Dev(): Plugin {
  return {
    name: "spicebench-esp32-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/esp32", (req, res) => {
        const send = (code: number, body: unknown) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)) }
        const bin = findQemu()
        const url = req.url ?? "/"
        if (req.method === "GET" && (url === "/" || url === "")) {
          if (!bin) { send(404, { error: "Espressif's QEMU (qemu-system-xtensa) was not found" }); return }
          send(200, { version: `${execFileSync(bin, ["--version"], { encoding: "utf8" }).split("\n")[0]} · ${bin}` }); return
        }
        if (url.startsWith("/poll")) {
          if (!session) { send(200, { serial: "", bridge: [], running: false, log: "" }); return }
          const s = session
          const out = { serial: s.serial, bridge: s.bridge, running: s.running, log: s.running ? "" : s.log }
          s.serial = ""; s.bridge = []
          send(200, out); return
        }
        let body = ""
        req.on("data", (c) => (body += c))
        req.on("end", async () => {
          const j = body ? JSON.parse(body) : {}
          if (url.startsWith("/stop")) { stop(); send(200, {}); return }
          if (url.startsWith("/send")) {
            if (!session) { send(400, { error: "The ESP32 is not running" }); return }
            if (j.serial) session.child.stdin?.write(j.serial)
            if (j.bridge) session.sock?.write(Buffer.from(j.bridge))
            send(200, {}); return
          }
          if (url.startsWith("/start")) {
            stop()
            if (!bin) { send(404, { error: "Espressif's QEMU (qemu-system-xtensa) was not found" }); return }
            const dir = path.join(os.tmpdir(), "spacebench-esp32"); fs.mkdirSync(dir, { recursive: true })
            const flash = path.join(dir, "flash-dev.bin"); fs.copyFileSync(j.image, flash)
            const port = await freePort()
            const child = spawn(bin, ["-nographic", "-machine", "esp32", "-m", "4M", "-monitor", "none", "-nic", "none", "-drive", `file=${flash},if=mtd,format=raw`, "-serial", "stdio", "-serial", "null", "-serial", `tcp:127.0.0.1:${port},server=on,wait=off`])
            const s = { child, sock: null as net.Socket | null, serial: "", bridge: [] as number[], log: "", running: true }
            session = s
            child.stdout.on("data", (d) => (s.serial += d.toString("latin1")))
            child.stderr.on("data", (d) => (s.log += d))
            child.on("exit", () => (s.running = false))
            for (let i = 0; i < 50 && !s.sock; i++) {
              await new Promise((r) => setTimeout(r, 40))
              await new Promise<void>((ok) => { const c = net.connect(port, "127.0.0.1", () => { s.sock = c; ok() }); c.on("error", () => ok()); c.on("data", (d) => s.bridge.push(...d)) })
            }
            send(s.sock ? 200 : 500, s.sock ? {} : { error: "QEMU's bridge port did not open" }); return
          }
          send(404, { error: "unknown" })
        })
      })
    },
  }
}
