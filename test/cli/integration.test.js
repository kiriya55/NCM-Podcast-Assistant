'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { Readable } = require('node:stream')

const { runCli } = require('../../electron/cli')

function capture() {
  let value = ''
  return {
    write(chunk) { value += String(chunk); return true },
    text() { return value },
  }
}

function fakeServices(overrides = {}) {
  return {
    authService: {},
    cookieStore: { getCookies: () => ({}), getToken: () => '' },
    llmService: {},
    musicPartnerService: {},
    podcastService: {},
    settingsStore: { getAll: () => ({}), get: () => '' },
    ...overrides,
  }
}

function io({ stdin = Readable.from([]), env = {} } = {}) {
  return { stdin, stdout: capture(), stderr: capture(), env, cwd: process.cwd() }
}

test('runCli keeps service diagnostics off JSON stdout and restores console methods', async () => {
  const streams = io()
  const originalLog = console.log
  const exitCode = await runCli(['--json', 'podcast', 'list'], streams, {
    services: fakeServices({
      podcastService: {
        getPodcastList: async () => {
          console.log('service diagnostic')
          return [{ id: 1, name: 'Podcast' }]
        },
      },
    }),
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(JSON.parse(streams.stdout.text()).data, [{ id: 1, name: 'Podcast' }])
  assert.equal(streams.stderr.text(), 'service diagnostic\n')
  assert.equal(console.log, originalLog)
})

test('runCli returns a machine-readable usage error for unknown options', async () => {
  const streams = io()
  const exitCode = await runCli(['--json', 'podcast', 'list', '--destructive', 'true'], streams, {
    services: fakeServices({ podcastService: { getPodcastList: async () => [] } }),
  })

  assert.equal(exitCode, 2)
  assert.equal(JSON.parse(streams.stdout.text()).error.code, 'INVALID_INPUT')
})

test('runCli reads structured stdin and redacts its API key from stdout and diagnostics', async () => {
  const streams = io({ stdin: Readable.from(['{"openaiApiKey":"new-secret","openaiModel":"gpt-4.1"}']) })
  const saved = []
  const exitCode = await runCli(['--json', 'settings', 'set', '--input', '-'], streams, {
    services: fakeServices({
      settingsStore: {
        getAll: () => ({}),
        get: () => 'new-secret',
        save: value => saved.push(value),
      },
      llmService: {
        updateConfig: () => console.log('configured new-secret'),
      },
    }),
  })

  assert.equal(exitCode, 0)
  assert.equal(saved[0].openaiApiKey, 'new-secret')
  assert.doesNotMatch(streams.stdout.text(), /new-secret/)
  assert.doesNotMatch(streams.stderr.text(), /new-secret/)
  assert.match(streams.stderr.text(), /\[REDACTED\]/)
})

test('runCli renders prefix help without invoking a service', async () => {
  const streams = io()
  const exitCode = await runCli(['auth', 'sms', '--help'], streams, { services: fakeServices() })

  assert.equal(exitCode, 0)
  assert.match(streams.stdout.text(), /auth sms send/)
  assert.match(streams.stdout.text(), /auth sms verify/)
})

test('runCli emits CONFIRMATION_REQUIRED before a delete service call', async () => {
  const streams = io()
  let deleteCalls = 0
  const exitCode = await runCli([
    '--json', 'episode', 'delete', '--podcast-id', '1', '--episode-id', '2',
  ], streams, {
    services: fakeServices({
      podcastService: { deleteVoice: async () => { deleteCalls += 1 } },
    }),
  })

  assert.equal(exitCode, 2)
  assert.equal(JSON.parse(streams.stdout.text()).error.code, 'CONFIRMATION_REQUIRED')
  assert.equal(deleteCalls, 0)
})

test('bin entry executes a real JSON auth status command', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncm-cli-bin-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

  const result = spawnSync(process.execPath, [path.join(process.cwd(), 'bin', 'ncm-podcast.js'), '--json', 'auth', 'status'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, NCM_DATA_DIR: dataDir },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout).data, { isLoggedIn: false })
})
