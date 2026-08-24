'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const runnerPath = path.join(process.cwd(), 'scripts', 'run-tests.js')

test('cross-platform test runner discovers nested .test.js files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncm-test-runner-'))
  const nested = path.join(root, 'nested')
  const marker = path.join(root, 'executed.txt')
  fs.mkdirSync(nested)
  fs.writeFileSync(path.join(nested, 'sample.test.js'), [
    "const { test } = require('node:test')",
    "const assert = require('node:assert/strict')",
    "const fs = require('node:fs')",
    `test('sample passes', () => { assert.equal(2 + 2, 4); fs.writeFileSync(${JSON.stringify(marker)}, 'ran') })`,
  ].join('\n'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const result = spawnSync(process.execPath, [runnerPath, root], { encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(marker, 'utf8'), 'ran')
})

test('cross-platform test runner fails when no tests are discovered', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncm-test-runner-empty-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const result = spawnSync(process.execPath, [runnerPath, root], { encoding: 'utf8' })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /No test files found/)
})
