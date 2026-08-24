#!/usr/bin/env node
'use strict'

const { runCli } = require('../electron/cli')

const controller = new AbortController()
const signalHandlers = new Map()

for (const signalName of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  const handler = () => controller.abort(new Error(`Received ${signalName}`))
  signalHandlers.set(signalName, handler)
  process.once(signalName, handler)
}

runCli(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  cwd: process.cwd(),
  signal: controller.signal,
}).then(code => {
  process.exitCode = code
}).catch(error => {
  process.stderr.write(`${error?.message || error}\n`)
  process.exitCode = 4
}).finally(() => {
  for (const [signalName, handler] of signalHandlers) {
    process.removeListener(signalName, handler)
  }
})
