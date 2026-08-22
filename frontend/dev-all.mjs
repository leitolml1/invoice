import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKEND = path.resolve(__dirname, '..', 'backend')

function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', shell: false, ...options })
  child.on('exit', (code) => {
    if (code && code !== 0) process.exitCode = code
  })
  return child
}

// API real: Modulo A (OCR + LLM con QVAC) + Modulo B (matching).
// Antes esto levantaba frontend/server.js, que devolvia un objeto de ejemplo
// fijo. Ese stub se elimino: ya no existe ningun camino que responda
// /reconcile sin correr inferencia real.
const api = run(process.execPath, [path.join(BACKEND, 'src', 'server.js')], {
  cwd: BACKEND,
  env: process.env,
})

const vite = run(process.execPath, ['./node_modules/vite/bin/vite.js'])

function shutdown() {
  api.kill()
  vite.kill()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
