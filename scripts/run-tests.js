'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function collectTests(target, files) {
  if (!fs.existsSync(target)) return
  const stat = fs.statSync(target)
  if (stat.isFile()) {
    if (target.endsWith('.test.js')) files.push(target)
    return
  }
  if (!stat.isDirectory()) return

  for (const entry of fs.readdirSync(target).sort()) {
    collectTests(path.join(target, entry), files)
  }
}

const roots = process.argv.slice(2)
const targets = roots.length > 0 ? roots : ['test']
const files = []
for (const target of targets) collectTests(path.resolve(target), files)

if (files.length === 0) {
  process.stderr.write(`No test files found under: ${targets.join(', ')}\n`)
  process.exitCode = 1
} else {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env })
  process.exitCode = result.status ?? 1
}
