'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { CliError, exitCodeFor } = require('../../electron/cli/errors')

test('CliError preserves the stable public contract', () => {
  const cause = new Error('socket failed')
  const error = new CliError('REMOTE_ERROR', '请求失败', { endpoint: '/voices' }, cause)

  assert.equal(error.name, 'CliError')
  assert.equal(error.code, 'REMOTE_ERROR')
  assert.equal(error.message, '请求失败')
  assert.deepEqual(error.details, { endpoint: '/voices' })
  assert.equal(error.cause, cause)
})

test('exitCodeFor maps public failures and defaults unknown failures to local or remote failure', () => {
  assert.equal(exitCodeFor(new CliError('INVALID_INPUT', 'bad')), 2)
  assert.equal(exitCodeFor(new CliError('CONFIRMATION_REQUIRED', 'confirm')), 2)
  assert.equal(exitCodeFor(new CliError('AUTH_REQUIRED', 'login')), 3)
  assert.equal(exitCodeFor(new CliError('UNLOCK_FAILED', 'unlock')), 3)
  assert.equal(exitCodeFor(new CliError('PARTIAL_FAILURE', 'partial')), 5)
  assert.equal(exitCodeFor(new CliError('TIMEOUT', 'slow')), 124)
  assert.equal(exitCodeFor(new CliError('CANCELLED', 'stop')), 130)
  assert.equal(exitCodeFor(new Error('unexpected')), 4)
})
