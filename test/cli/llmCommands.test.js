'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createLlmCommands } = require('../../electron/cli/commands/llm')

test('llm parse forwards source text and optional templates', async () => {
  const calls = []
  const commands = createLlmCommands({
    llmService: {
      parseSongInfo: async (...args) => {
        calls.push(args)
        return { raw: { songTitle: 'Song' }, name: 'Rendered', description: 'Description' }
      },
    },
  })

  assert.deepEqual(
    await commands['llm parse']({ input: { text: 'source', template: { nameTemplate: '{songTitle}' } }, options: {} }),
    { raw: { songTitle: 'Song' }, name: 'Rendered', description: 'Description' }
  )
  assert.deepEqual(calls, [['source', { nameTemplate: '{songTitle}' }]])
})

test('llm parse rejects empty text and unknown template fields', async () => {
  const commands = createLlmCommands({ llmService: { parseSongInfo: async () => ({}) } })

  await assert.rejects(commands['llm parse']({ input: { text: ' ' }, options: {} }), error => error.code === 'INVALID_INPUT')
  await assert.rejects(
    commands['llm parse']({ input: { text: 'source', template: { arbitrary: true } }, options: {} }),
    error => error.code === 'INVALID_INPUT'
  )
})
