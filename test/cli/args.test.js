'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { parseArgv } = require('../../electron/cli/args')

test('parseArgv accepts a global mode before a nested command', () => {
  assert.deepEqual(
    parseArgv(['--json', 'episode', 'list', '--podcast-id', '42']),
    {
      mode: 'json',
      commandPath: ['episode', 'list'],
      options: { json: true, podcastId: '42' },
      positionals: [],
    }
  )
})

test('parseArgv accumulates repeatable file and episode identifiers', () => {
  assert.deepEqual(
    parseArgv(['upload', 'batch', '--file', 'one.mp3', '--file=two.mp3', '--episode-id', '1', '--episode-id', '2']),
    {
      mode: 'human',
      commandPath: ['upload', 'batch'],
      options: { file: ['one.mp3', 'two.mp3'], episodeId: ['1', '2'] },
      positionals: [],
    }
  )
})

test('parseArgv recognizes boolean options without consuming the command', () => {
  assert.deepEqual(
    parseArgv(['--yes', 'episode', 'delete', '--help']),
    {
      mode: 'human',
      commandPath: ['episode', 'delete'],
      options: { yes: true, help: true },
      positionals: [],
    }
  )
})

test('parseArgv keeps all nested command words in the command path', () => {
  assert.deepEqual(parseArgv(['auth', 'sms', 'send']), {
    mode: 'human',
    commandPath: ['auth', 'sms', 'send'],
    options: {},
    positionals: [],
  })
})

test('parseArgv rejects conflicting output modes, short flags, and missing values', () => {
  assert.throws(() => parseArgv(['--json', '--jsonl', 'podcast', 'list']), /mutually exclusive/i)
  assert.throws(() => parseArgv(['-j', 'podcast', 'list']), /long options/i)
  assert.throws(() => parseArgv(['podcast', 'list', '--page']), /requires a value/i)
})
