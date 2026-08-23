// Electron processes started from another Electron host may inherit this flag
// and run as plain Node. Clear it before spawning the actual Electron binary.
const { spawn } = require('child_process')
const electron = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, process.argv.slice(2), {
  stdio: 'inherit',
  windowsHide: false,
  env,
})

child.on('close', (code, signal) => {
  if (code === null) {
    process.kill(process.pid, signal)
  } else {
    process.exit(code)
  }
})

child.on('error', (error) => {
  console.error('Failed to start Electron:', error)
  process.exit(1)
})

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}
