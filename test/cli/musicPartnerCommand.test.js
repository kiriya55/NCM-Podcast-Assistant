'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createMusicPartnerCommands } = require('../../electron/cli/commands/musicPartner')
const { CliError } = require('../../electron/cli/errors')

function outputEvents() {
  const events = []
  return { events, output: { event: (name, data) => events.push({ name, data }) } }
}

test('music-partner verify delegates to the existing verification service', async () => {
  const expected = { success: true, nickname: 'Roy', userId: 7 }
  const commands = createMusicPartnerCommands({
    musicPartnerService: { verifyUser: async () => expected },
  })

  assert.equal(await commands['music-partner verify']({}), expected)
})

test('music-partner run rejects plain JSON before unlock or Electron spawn', async () => {
  let unlockCalls = 0
  let spawnCalls = 0
  const commands = createMusicPartnerCommands({
    musicPartnerService: {},
    validateUnlock: () => { unlockCalls += 1 },
    spawnRunner: async () => { spawnCalls += 1 },
  })

  await assert.rejects(
    commands['music-partner run']({ mode: 'json', env: {}, output: outputEvents().output }),
    error => error.code === 'INVALID_INPUT'
  )
  assert.equal(unlockCalls, 0)
  assert.equal(spawnCalls, 0)
})

test('music-partner run rejects an invalid unlock before Electron spawn', async () => {
  let spawned = false
  const commands = createMusicPartnerCommands({
    musicPartnerService: {},
    validateUnlock: () => { throw new CliError('UNLOCK_FAILED', 'Unlock failed') },
    spawnRunner: async () => { spawned = true },
  })

  await assert.rejects(
    commands['music-partner run']({
      mode: 'jsonl', env: {}, output: outputEvents().output,
      signal: new AbortController().signal,
    }),
    error => error.code === 'UNLOCK_FAILED'
  )
  assert.equal(spawned, false)
})

test('music-partner run forwards child progress and returns its result', async () => {
  const observed = outputEvents()
  const env = { NCM_MP_PASSWORD: 'runtime-only' }
  const signal = new AbortController().signal
  let spawnOptions
  const commands = createMusicPartnerCommands({
    musicPartnerService: {},
    validateUnlock: options => assert.equal(options.env, env),
    spawnRunner: async options => {
      spawnOptions = options
      options.onEvent('state', { status: 'daily', current: 1, total: 5 })
      return { success: true }
    },
  })

  assert.deepEqual(await commands['music-partner run']({
    mode: 'jsonl', env, output: observed.output, signal,
  }), { success: true })
  assert.equal(spawnOptions.env, env)
  assert.equal(spawnOptions.signal, signal)
  assert.deepEqual(observed.events, [
    { name: 'state', data: { status: 'daily', current: 1, total: 5 } },
  ])
})
