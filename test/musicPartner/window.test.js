'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const path = require('node:path')

const { createMusicPartnerWindow, MUSIC_PARTNER_URL, MUSIC_PARTNER_UA } = require('../../electron/musicPartner/window')

function createHarness() {
  const writes = []
  const unlinks = []
  const cookieSets = []
  const cleared = []
  const requestHooks = {}
  let browserWindowOptions
  let windowOpenHandler

  const partnerSession = {
    cookies: { set: async value => { cookieSets.push(value) } },
    clearStorageData: async () => { cleared.push(true) },
    webRequest: {
      onBeforeRequest: (_filter, callback) => { requestHooks.beforeRequest = callback },
      onBeforeSendHeaders: (_filter, callback) => { requestHooks.beforeSendHeaders = callback },
      onHeadersReceived: (_filter, callback) => { requestHooks.headersReceived = callback },
    },
  }

  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super()
      browserWindowOptions = options
      this.showCalls = 0
      this.focusCalls = 0
      this.destroyCalls = 0
      this.destroyed = false
      this.loaded = null
      this.webContents = new EventEmitter()
      this.webContents.session = partnerSession
      this.webContents.setWindowOpenHandler = handler => { windowOpenHandler = handler }
      this.webContents.executeJavaScript = async () => true
      this.webContents.getURL = () => MUSIC_PARTNER_URL
    }

    async loadURL(url, options) {
      this.loaded = { url, options }
      this.emit('ready-to-show')
    }

    show() { this.showCalls += 1 }
    focus() { this.focusCalls += 1 }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.destroyCalls += 1; this.emit('closed') }
  }

  const dependencies = {
    BrowserWindow: FakeBrowserWindow,
    app: { getPath: () => 'D:\\temp' },
    cookieStore: {
      getCookies: () => ({ MUSIC_U: 'login-token', __csrf: 'csrf-token' }),
      getNickname: () => 'Roy',
      getUserId: () => '7',
    },
    createBridgeScript: ({ nickname, userId }) => `bridge:${nickname}:${userId}`,
    fs: {
      writeFileSync: (...args) => writes.push(args),
      promises: { unlink: async file => { unlinks.push(file) } },
    },
    logger: { log() {}, warn() {}, error() {} },
    path,
    randomUUID: () => 'window-id',
  }

  return {
    cleared,
    cookieSets,
    dependencies,
    get browserWindowOptions() { return browserWindowOptions },
    get windowOpenHandler() { return windowOpenHandler },
    requestHooks,
    unlinks,
    writes,
  }
}

test('CLI Music Partner window starts hidden with its mobile session contract', async () => {
  const harness = createHarness()
  const handle = await createMusicPartnerWindow({
    ...harness.dependencies,
    partition: 'music-partner-cli-test',
    showOnReady: false,
  })

  assert.equal(harness.browserWindowOptions.show, false)
  assert.equal(harness.browserWindowOptions.width, 400)
  assert.equal(harness.browserWindowOptions.height, 750)
  assert.equal(harness.browserWindowOptions.webPreferences.partition, 'music-partner-cli-test')
  assert.equal(harness.browserWindowOptions.webPreferences.backgroundThrottling, false)
  assert.deepEqual(harness.windowOpenHandler(), { action: 'deny' })
  assert.deepEqual(handle.browserWindow.loaded, { url: MUSIC_PARTNER_URL, options: { userAgent: MUSIC_PARTNER_UA } })
  assert.equal(handle.browserWindow.showCalls, 0)
  assert.match(harness.writes[0][0], /music-partner-bridge-preload-window-id\.js$/)
  assert.equal(harness.writes[0][1], 'bridge:Roy:7')
  assert.ok(harness.cookieSets.some(cookie => cookie.name === 'MUSIC_U' && cookie.value === 'login-token'))
})

test('GUI Music Partner window preserves show-on-ready behavior', async () => {
  const harness = createHarness()
  const handle = await createMusicPartnerWindow({
    ...harness.dependencies,
    partition: 'persist:music-partner',
    showOnReady: true,
  })

  assert.equal(handle.browserWindow.showCalls, 1)
})

test('Music Partner window blocks non-NetEase navigation and external windows', async () => {
  const harness = createHarness()
  const handle = await createMusicPartnerWindow({ ...harness.dependencies, showOnReady: false })
  let prevented = 0

  handle.browserWindow.webContents.emit('will-navigate', { preventDefault: () => { prevented += 1 } }, 'https://evil.example/path')
  handle.browserWindow.webContents.emit('will-navigate', { preventDefault: () => { prevented += 1 } }, 'https://music.163.com/path')

  assert.equal(prevented, 1)
  assert.deepEqual(harness.windowOpenHandler(), { action: 'deny' })
})

test('Music Partner window cleanup destroys, clears and unlinks exactly once', async () => {
  const harness = createHarness()
  const handle = await createMusicPartnerWindow({ ...harness.dependencies, showOnReady: false })

  await Promise.all([handle.cleanup({ clearStorage: true }), handle.cleanup({ clearStorage: true })])

  assert.equal(handle.browserWindow.destroyCalls, 1)
  assert.equal(harness.cleared.length, 1)
  assert.deepEqual(harness.unlinks, ['D:\\temp\\music-partner-bridge-preload-window-id.js'])
})
