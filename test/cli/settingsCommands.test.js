'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createSettingsCommands } = require('../../electron/cli/commands/settings')

test('settings get omits the API key and reports whether it is configured', async () => {
  const commands = createSettingsCommands({
    settingsStore: { getAll: () => ({ openaiApiKey: 'secret', openaiModel: 'gpt-4o', systemPrompt: 'prompt' }) },
    llmService: {},
  })

  assert.deepEqual(await commands['settings get']({ options: {}, input: {} }), {
    openaiModel: 'gpt-4o',
    systemPrompt: 'prompt',
    hasOpenaiApiKey: true,
  })
})

test('settings set updates only recognized fields and never echoes the API key', async () => {
  const saved = []
  const configured = []
  const commands = createSettingsCommands({
    settingsStore: { save: value => saved.push(value), get: key => key === 'openaiApiKey' ? 'secret' : undefined },
    llmService: { updateConfig: value => configured.push(value) },
  })

  assert.deepEqual(
    await commands['settings set']({ options: {}, input: { openaiApiKey: 'new-secret', openaiModel: 'gpt-4.1' } }),
    { updated: ['openaiApiKey', 'openaiModel'], hasOpenaiApiKey: true }
  )
  assert.deepEqual(saved, [{ openaiApiKey: 'new-secret', openaiModel: 'gpt-4.1' }])
  assert.deepEqual(configured, [{ openaiApiKey: 'new-secret', openaiModel: 'gpt-4.1' }])
})

test('settings set rejects unknown or empty updates', async () => {
  const commands = createSettingsCommands({ settingsStore: {}, llmService: {} })

  await assert.rejects(commands['settings set']({ options: {}, input: { arbitrary: true } }), error => error.code === 'INVALID_INPUT')
  await assert.rejects(commands['settings set']({ options: {}, input: {} }), error => error.code === 'INVALID_INPUT')
})
