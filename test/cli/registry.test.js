'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createRegistry } = require('../../electron/cli/registry')

function fakeServices() {
  return {
    authService: {},
    cookieStore: {},
    llmService: {},
    musicPartnerService: {},
    podcastService: {},
    settingsStore: {},
  }
}

test('registry exposes every ordinary CLI command with SMS naming', () => {
  const registry = createRegistry({ services: fakeServices() })

  assert.deepEqual(registry.list().map(item => item.name), [
    'audio metadata',
    'auth login-qr',
    'auth logout',
    'auth sms send',
    'auth sms verify',
    'auth status',
    'auth whoami',
    'cover set-episode',
    'cover set-podcast',
    'cover upload',
    'episode delete',
    'episode get',
    'episode list',
    'episode update',
    'llm parse',
    'podcast list',
    'settings get',
    'settings set',
    'upload batch',
    'upload one',
  ])
  assert.match(registry.help(['auth', 'sms']), /auth sms send/)
  assert.match(registry.help(['auth', 'sms']), /auth sms verify/)
  assert.doesNotMatch(registry.help([]), /captcha/)
})

test('registry resolves a handler by nested command path', () => {
  const registry = createRegistry({ services: fakeServices() })
  const definition = registry.get(['episode', 'list'])

  assert.equal(definition.name, 'episode list')
  assert.equal(typeof definition.handler, 'function')
})

test('registry rejects unknown command options and positional arguments', () => {
  const registry = createRegistry({ services: fakeServices() })

  assert.throws(
    () => registry.validate('podcast list', { destructive: true }, []),
    error => error.code === 'INVALID_INPUT' && /unknown option/i.test(error.message)
  )
  assert.throws(
    () => registry.validate('podcast list', {}, ['unexpected']),
    error => error.code === 'INVALID_INPUT' && /positional/i.test(error.message)
  )
})

test('registry allows global output and help options for every command', () => {
  const registry = createRegistry({ services: fakeServices() })
  assert.doesNotThrow(() => registry.validate('podcast list', { json: true, help: true }, []))
})
