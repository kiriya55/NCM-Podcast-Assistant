'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { CliError } = require('../../electron/cli/errors')
const { createOutput, redact } = require('../../electron/cli/output')

function capture() {
  let value = ''
  return {
    write(chunk) { value += String(chunk); return true },
    text() { return value },
  }
}

test('JSON success writes one versioned envelope and redacts nested secrets', () => {
  const stdout = capture()
  const output = createOutput({
    mode: 'json',
    stdout,
    stderr: capture(),
    secrets: ['abc123'],
    command: 'auth whoami',
  })

  output.success({
    cookie: 'MUSIC_U=abc123',
    nested: { openaiApiKey: 'abc123', code: 803 },
  })

  assert.deepEqual(JSON.parse(stdout.text()), {
    ok: true,
    data: {
      cookie: '[REDACTED]',
      nested: { openaiApiKey: '[REDACTED]', code: 803 },
    },
    meta: { command: 'auth whoami', version: 1 },
  })
})

test('JSON failure keeps the public error code and redacts diagnostics', () => {
  const stdout = capture()
  const stderr = capture()
  const output = createOutput({ mode: 'json', stdout, stderr, secrets: ['token-value'], command: 'podcast list' })

  output.diagnostic('request used token-value')
  output.failure(new CliError('AUTH_REQUIRED', '请先登录', { token: 'token-value' }))

  const envelope = JSON.parse(stdout.text())
  assert.equal(envelope.error.code, 'AUTH_REQUIRED')
  assert.equal(envelope.error.details.token, '[REDACTED]')
  assert.equal(stderr.text(), 'request used [REDACTED]\n')
})

test('JSON Lines emits progress followed by exactly one terminal event', () => {
  const stdout = capture()
  const output = createOutput({ mode: 'jsonl', stdout, stderr: capture(), secrets: [], command: 'upload batch' })

  output.event('progress', { current: 1, total: 2 })
  output.success({ uploaded: 2 })

  const lines = stdout.text().trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(lines, [
    { event: 'progress', data: { current: 1, total: 2 }, meta: { command: 'upload batch', version: 1 } },
    { event: 'result', ok: true, data: { uploaded: 2 }, meta: { command: 'upload batch', version: 1 } },
  ])
  assert.throws(() => output.failure(new CliError('REMOTE_ERROR', 'late')), /terminal event/i)
})

test('redact masks known secret fields but leaves ordinary code and model fields intact', () => {
  assert.deepEqual(
    redact({ code: 'REMOTE_ERROR', smsCode: '1234', openaiModel: 'gpt-4o' }, []),
    { code: 'REMOTE_ERROR', smsCode: '[REDACTED]', openaiModel: 'gpt-4o' }
  )
})
