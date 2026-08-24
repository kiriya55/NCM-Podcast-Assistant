'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')

const {
  runMusicPartnerChild,
  spawnMusicPartnerRunner,
} = require('../../electron/cli/musicPartnerRunner')

function fakeSpawn(calls, lines, { exitCode = 0 } = {}) {
  return (command, args, options) => {
    calls.push({ command, args, options })
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.killCalls = 0
    child.kill = () => { child.killCalls += 1 }
    queueMicrotask(() => {
      for (const line of lines) child.stdout.write(`${line}\n`)
      child.stdout.end()
      child.stderr.end()
      child.emit('close', exitCode, null)
    })
    return child
  }
}

test('runner child receives one authorization marker but no passwords in arguments or environment', async () => {
  const calls = []
  const events = []
  const result = await spawnMusicPartnerRunner({
    electronPath: 'electron',
    runnerPath: '/app/electron/cli/musicPartnerRunner.js',
    env: {
      PATH: '/bin',
      NCM_MP_PASSWORD: 'runtime-secret',
      VITE_MP_PASSWORD: 'reference-secret',
      OPENAI_API_KEY: 'llm-secret',
    },
    signal: new AbortController().signal,
    spawn: fakeSpawn(calls, [
      '{"event":"state","data":{"status":"daily"}}',
      '{"event":"result","data":{"success":true}}',
    ]),
    randomBytes: () => Buffer.from('one-run-marker'),
    onEvent: (name, data) => events.push({ name, data }),
  })

  assert.deepEqual(result, { success: true })
  assert.deepEqual(calls[0].args, ['/app/electron/cli/musicPartnerRunner.js'])
  assert.equal(calls[0].options.env.PATH, '/bin')
  assert.equal(calls[0].options.env.NCM_MP_PASSWORD, undefined)
  assert.equal(calls[0].options.env.VITE_MP_PASSWORD, undefined)
  assert.equal(calls[0].options.env.OPENAI_API_KEY, undefined)
  assert.ok(calls[0].options.env.NCM_MP_RUN_AUTH)
  assert.doesNotMatch(JSON.stringify(calls[0]), /runtime-secret|reference-secret|llm-secret/)
  assert.deepEqual(events, [{ name: 'state', data: { status: 'daily' } }])
})

test('parent rejects malformed child protocol', async () => {
  await assert.rejects(
    spawnMusicPartnerRunner({
      electronPath: 'electron', runnerPath: '/runner.js', env: {},
      signal: new AbortController().signal,
      spawn: fakeSpawn([], ['not-json']),
      onEvent() {},
    }),
    error => error.code === 'REMOTE_ERROR' && /protocol/i.test(error.message)
  )
})

function childHarness(startResults, inspectResults = [{ kind: 'rating' }]) {
  const stdout = new PassThrough()
  let stdoutText = ''
  stdout.on('data', chunk => { stdoutText += chunk })
  const stdin = new EventEmitter()
  stdin.resume = () => {}
  const processLike = new EventEmitter()
  const cleanupCalls = []
  const cancelCalls = []
  const window = {
    showCalls: 0,
    focusCalls: 0,
    cleanupCalls,
    browserWindow: {
      isDestroyed: () => false,
      webContents: { getURL: () => 'https://mp.music.163.com/' },
    },
    show() { this.showCalls += 1 },
    focus() { this.focusCalls += 1 },
    cleanup: async options => { cleanupCalls.push(options) },
  }
  const app = {
    commandLine: { switches: [], appendSwitch(...args) { this.switches.push(args) } },
    quitCalls: 0,
    whenReady: async () => {},
    quit() { this.quitCalls += 1 },
  }
  let startIndex = 0
  let inspectIndex = 0
  let markStarted
  const started = new Promise(resolve => { markStarted = resolve })
  const controller = {
    async start() {
      markStarted()
      const value = startResults[startIndex++]
      return typeof value === 'function' ? value() : value
    },
    cancel(reason) { cancelCalls.push(reason); return { success: true } },
    getWindowHandle: () => window,
  }

  return {
    app,
    cancelCalls,
    dependencies: {
      app,
      env: { NCM_MP_RUN_AUTH: 'one-run' },
      stdin,
      stdout,
      stderr: new PassThrough(),
      processLike,
      createServices: () => ({
        cookieStore: {},
        musicPartnerService: { verifyUser: async () => ({ success: true }) },
      }),
      createWindow: async () => window,
      createController: () => controller,
      createAdapter: () => ({
        inspect: async () => inspectResults[Math.min(inspectIndex++, inspectResults.length - 1)],
      }),
      createCheckpoint: () => ({}),
      sleep: async () => {},
      timeoutMs: 10000,
    },
    processLike,
    started,
    stdin,
    window,
    get stdoutText() { return stdoutText },
  }
}

test('child starts hidden, shows on manual intervention and cleans up after success', async () => {
  const harness = childHarness([
    { success: false, code: 'paused', reason: 'manual intervention required: choice-required' },
    { success: true },
  ], [{ kind: 'rating' }])

  assert.equal(await runMusicPartnerChild(harness.dependencies), 0)
  assert.equal(harness.window.showCalls, 1)
  assert.equal(harness.window.focusCalls, 1)
  assert.equal(harness.window.cleanupCalls.length, 1)
  assert.deepEqual(harness.window.cleanupCalls[0], { clearStorage: true })
  assert.equal(harness.app.quitCalls, 1)
  assert.equal(harness.dependencies.env.NCM_MP_RUN_AUTH, undefined)
  assert.match(harness.stdoutText, /"event":"result"/)
})

test('child cleanup runs once when parent closure and a fatal error race', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const harness = childHarness([() => pending])
  const originalCancel = harness.dependencies.createController().cancel
  harness.dependencies.createController().cancel = reason => {
    originalCancel(reason)
    release({ success: false, code: 'cancelled', reason })
    return { success: true }
  }

  const running = runMusicPartnerChild(harness.dependencies)
  await harness.started
  harness.stdin.emit('end')
  harness.processLike.emit('uncaughtException', new Error('second trigger'))

  assert.equal(await running, 130)
  assert.equal(harness.cancelCalls.length, 1)
  assert.equal(harness.window.cleanupCalls.length, 1)
  assert.equal(harness.app.quitCalls, 1)
})

test('child waits for in-flight window creation before cancellation cleanup', async () => {
  const harness = childHarness([{ success: true }])
  let releaseWindow
  let markCreating
  const creating = new Promise(resolve => { markCreating = resolve })
  harness.dependencies.createWindow = () => {
    markCreating()
    return new Promise(resolve => { releaseWindow = () => resolve(harness.window) })
  }

  const running = runMusicPartnerChild(harness.dependencies)
  await creating
  harness.stdin.emit('end')
  releaseWindow()

  assert.equal(await running, 130)
  assert.equal(harness.window.cleanupCalls.length, 1)
  assert.equal(harness.app.quitCalls, 1)
})
