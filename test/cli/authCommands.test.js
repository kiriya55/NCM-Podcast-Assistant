'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createAuthCommands } = require('../../electron/cli/commands/auth')

function sequence(values) {
  let index = 0
  return async () => values[index++]
}

function outputEvents() {
  const events = []
  return {
    events,
    output: { event: (name, data) => events.push({ name, data }) },
  }
}

test('auth sms send validates the phone and delegates to the SMS service', async () => {
  const calls = []
  const commands = createAuthCommands({
    authService: { sendCaptcha: async phone => { calls.push(phone); return { success: true } } },
    cookieStore: {},
  })

  assert.deepEqual(
    await commands['auth sms send']({ options: { phone: '13800138000' }, input: {} }),
    { success: true }
  )
  assert.deepEqual(calls, ['13800138000'])

  await assert.rejects(
    commands['auth sms send']({ options: { phone: 'not-a-phone' }, input: {} }),
    error => error.code === 'INVALID_INPUT'
  )
})

test('auth sms verify reads the phone and code from structured input', async () => {
  const calls = []
  const commands = createAuthCommands({
    authService: { verifyCaptcha: async (phone, code) => { calls.push([phone, code]); return { success: true, nickname: 'Roy' } } },
    cookieStore: {},
  })

  assert.deepEqual(
    await commands['auth sms verify']({ options: {}, input: { phone: '13800138000', code: '4321' } }),
    { success: true, nickname: 'Roy' }
  )
  assert.deepEqual(calls, [['13800138000', '4321']])
})

test('auth status and whoami expose login state without returning cookies', async () => {
  const commands = createAuthCommands({
    authService: { getUserInfo: async () => ({ userId: '7', nickname: 'Roy', avatarUrl: 'https://example/avatar' }) },
    cookieStore: { getToken: () => 'stored-token' },
  })

  assert.deepEqual(await commands['auth status']({ options: {}, input: {} }), { isLoggedIn: true })
  assert.deepEqual(await commands['auth whoami']({ options: {}, input: {} }), {
    userId: '7', nickname: 'Roy', avatarUrl: 'https://example/avatar',
  })
})

test('auth whoami rejects a missing login token', async () => {
  const commands = createAuthCommands({ authService: {}, cookieStore: { getToken: () => '' } })
  await assert.rejects(commands['auth whoami']({ options: {}, input: {} }), error => error.code === 'AUTH_REQUIRED')
})

test('auth logout requires confirmation and clears the shared session once confirmed', async () => {
  let logoutCalls = 0
  const commands = createAuthCommands({ authService: { logout: () => { logoutCalls += 1 } }, cookieStore: {} })

  await assert.rejects(commands['auth logout']({ options: {}, input: {} }), error => error.code === 'CONFIRMATION_REQUIRED')
  assert.equal(logoutCalls, 0)

  assert.deepEqual(await commands['auth logout']({ options: { yes: true }, input: {} }), { success: true })
  assert.equal(logoutCalls, 1)
})

test('auth login-qr emits the URL and polling state before success', async () => {
  const observed = outputEvents()
  const commands = createAuthCommands({
    authService: {
      getQRKey: async () => ({ unikey: 'key-1' }),
      getQRCode: async () => ({ qrText: 'https://music.163.com/login?codekey=key-1' }),
      checkQRLogin: sequence([
        { success: false, code: 801, message: '等待扫码' },
        { success: true, code: 803, message: '登录成功' },
      ]),
    },
    cookieStore: {},
    sleep: async () => {},
  })

  const result = await commands['auth login-qr']({
    options: {}, input: {}, mode: 'jsonl', output: observed.output,
    signal: new AbortController().signal,
  })

  assert.deepEqual(result, { success: true, code: 803, message: '登录成功' })
  assert.deepEqual(observed.events, [
    { name: 'start', data: { qrUrl: 'https://music.163.com/login?codekey=key-1' } },
    { name: 'progress', data: { code: 801, message: '等待扫码' } },
  ])
})

test('auth login-qr rejects plain JSON mode because polling is a stream', async () => {
  const commands = createAuthCommands({ authService: {}, cookieStore: {} })
  await assert.rejects(
    commands['auth login-qr']({ options: {}, input: {}, mode: 'json', output: outputEvents().output, signal: new AbortController().signal }),
    error => error.code === 'INVALID_INPUT'
  )
})
