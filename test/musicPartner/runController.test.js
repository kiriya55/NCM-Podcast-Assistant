'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createMusicPartnerRunController } = require('../../electron/musicPartner/runController')

function createHarness(results) {
  let automationIndex = 0
  let ensureCalls = 0
  let destroyCalls = 0
  const emitted = []
  const cancelCalls = []
  const handles = []

  const controller = createMusicPartnerRunController({
    checkpointStore: {},
    createAdapter: () => ({ inspect() {} }),
    createAutomation: ({ emit }) => {
      const configured = results[automationIndex++]
      return {
        async start() {
          emit({ status: configured.status || 'daily', current: configured.current || 0, total: 5 })
          return configured.result
        },
        cancel(reason) { cancelCalls.push(reason); configured.cancel?.(reason) },
        getStatus() { return { status: configured.status || 'daily' } },
      }
    },
    createStrategy: () => ({ score() {} }),
    destroyWindow: async handle => { destroyCalls += 1; handle.destroyed = true },
    emit: state => emitted.push(state),
    ensureWindow: async () => {
      ensureCalls += 1
      const handle = {
        browserWindow: {
          isDestroyed: () => false,
          webContents: { getURL: () => 'https://mp.music.163.com', isDestroyed: () => false },
        },
        destroyed: false,
      }
      handles.push(handle)
      return handle
    },
    logger: { log() {}, warn() {}, error() {} },
    sleep: async () => {},
  })

  return {
    cancelCalls,
    controller,
    emitted,
    get destroyCalls() { return destroyCalls },
    get ensureCalls() { return ensureCalls },
    handles,
  }
}

test('run controller returns a successful automation result without recreating the window', async () => {
  const harness = createHarness([{ result: { success: true } }])

  assert.deepEqual(await harness.controller.start(), { success: true })
  assert.equal(harness.ensureCalls, 1)
  assert.equal(harness.destroyCalls, 0)
  assert.equal(harness.controller.getStatus().status, 'daily')
})

test('run controller recreates the window for at most two recoverable failures', async () => {
  const harness = createHarness([
    { result: { success: false, code: 'paused', reason: 'page changed' } },
    { result: { success: false, code: 'paused', reason: 'page changed again' } },
    { result: { success: true } },
  ])

  assert.deepEqual(await harness.controller.start(), { success: true })
  assert.equal(harness.ensureCalls, 3)
  assert.equal(harness.destroyCalls, 2)
})

test('run controller preserves the same window for manual intervention', async () => {
  const harness = createHarness([{
    result: { success: false, code: 'paused', reason: 'manual intervention required: choice-dialog' },
  }])

  const result = await harness.controller.start()

  assert.equal(result.code, 'paused')
  assert.equal(harness.ensureCalls, 1)
  assert.equal(harness.destroyCalls, 0)
})

test('run controller rejects a duplicate start while one run is active', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const harness = createHarness([{ result: pending }])

  const first = harness.controller.start()
  assert.deepEqual(await harness.controller.start(), { success: false, code: 'already-running' })
  release({ success: true })
  assert.deepEqual(await first, { success: true })
})

test('run controller cancellation reaches the active automation and returns cancelled', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const harness = createHarness([{
    result: pending,
    cancel: () => release({ success: false, code: 'paused', reason: 'test stop' }),
  }])

  const running = harness.controller.start()
  await Promise.resolve()
  assert.deepEqual(harness.controller.cancel('test stop'), { success: true })

  assert.deepEqual(await running, { success: false, code: 'cancelled', reason: 'test stop' })
  assert.deepEqual(harness.cancelCalls, ['test stop'])
})
