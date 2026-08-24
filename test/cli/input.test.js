'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')

const { readJsonInput, resolveInputPath } = require('../../electron/cli/input')

test('readJsonInput uses the manifest directory as the base for relative paths', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncm-cli-input-'))
  const manifestDir = path.join(root, 'batch')
  const manifestPath = path.join(manifestDir, 'manifest.json')
  fs.mkdirSync(manifestDir)
  fs.writeFileSync(manifestPath, '{"files":[{"file":"./song.mp3"}]}', 'utf8')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const result = await readJsonInput(path.join('batch', 'manifest.json'), {
    cwd: root,
    stdin: Readable.from([]),
  })

  assert.deepEqual(result.value, { files: [{ file: './song.mp3' }] })
  assert.equal(result.baseDir, manifestDir)
  assert.equal(resolveInputPath(result.value.files[0].file, result.baseDir), path.join(manifestDir, 'song.mp3'))
})

test('readJsonInput reads stdin and resolves paths from the working directory', async () => {
  const result = await readJsonInput('-', {
    cwd: 'D:\\workspace',
    stdin: Readable.from(['{"file":"audio/song.mp3"}']),
  })

  assert.deepEqual(result.value, { file: 'audio/song.mp3' })
  assert.equal(result.baseDir, 'D:\\workspace')
  assert.equal(resolveInputPath(result.value.file, result.baseDir), 'D:\\workspace\\audio\\song.mp3')
})

test('readJsonInput rejects empty and malformed JSON with INVALID_INPUT', async () => {
  await assert.rejects(
    readJsonInput('-', { cwd: process.cwd(), stdin: Readable.from([]) }),
    (error) => error.code === 'INVALID_INPUT' && /empty/i.test(error.message)
  )

  await assert.rejects(
    readJsonInput('-', { cwd: process.cwd(), stdin: Readable.from(['{broken']) }),
    (error) => error.code === 'INVALID_INPUT' && /JSON/i.test(error.message)
  )
})

test('readJsonInput without an input reference returns an empty object', async () => {
  assert.deepEqual(
    await readJsonInput(null, { cwd: 'D:\\workspace', stdin: Readable.from([]) }),
    { value: {}, baseDir: 'D:\\workspace' }
  )
})
