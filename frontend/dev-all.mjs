import { spawn } from 'node:child_process'

function run(command, args) {
  const child = spawn(command, args, { stdio: 'inherit', shell: false })
  child.on('exit', (code) => {
    if (code && code !== 0) process.exitCode = code
  })
  return child
}

const api = run(process.execPath, ['server.js'])
const vite = run(process.execPath, [
  './node_modules/vite/bin/vite.js',
])

function shutdown() {
  api.kill()
  vite.kill()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
