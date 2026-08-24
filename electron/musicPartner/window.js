'use strict'

const nodeCrypto = require('node:crypto')
const nodeFs = require('node:fs')
const nodePath = require('node:path')

const { createMusicPartnerBridgeScript } = require('../musicPartnerBridge')
const { isAllowedPartnerNavigation } = require('./navigationPolicy')

const MUSIC_PARTNER_URL = 'https://mp.music.163.com/68429fb40fd3640105f60c9a/home/index.html?isH5=1&nm_style=sbt&bounces=false'
const MUSIC_PARTNER_UA = 'Mozilla/5.0 (Linux; Android 12; V2309A Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.154 Safari/537.36 CloudMusic/0.1.2 NeteaseMusic/9.5.05'
const REQUEST_URLS = ['https://*.music.163.com/*', 'https://*.127.net/*', 'https://*.music.126.net/*']

async function configureSession(partnerSession, cookieStore, logger) {
  partnerSession.webRequest.onBeforeRequest(
    { urls: ['http://*.music.126.net/*', 'http://*.music.163.com/*'] },
    (details, callback) => callback({ redirectURL: details.url.replace('http://', 'https://') })
  )

  partnerSession.webRequest.onBeforeSendHeaders(
    { urls: REQUEST_URLS },
    (details, callback) => {
      details.requestHeaders.Referer = 'https://mp.music.163.com/'
      details.requestHeaders['User-Agent'] = MUSIC_PARTNER_UA
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  partnerSession.webRequest.onHeadersReceived(
    { urls: REQUEST_URLS },
    (details, callback) => {
      const headers = details.responseHeaders || {}
      delete headers['access-control-allow-origin']
      delete headers['Access-Control-Allow-Origin']
      delete headers['access-control-allow-credentials']
      delete headers['Access-Control-Allow-Credentials']
      headers['Access-Control-Allow-Origin'] = ['https://mp.music.163.com']
      headers['Access-Control-Allow-Credentials'] = ['true']
      headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, OPTIONS']
      headers['Access-Control-Allow-Headers'] = ['*']
      callback({ responseHeaders: headers })
    }
  )

  const cookies = {
    ...cookieStore.getCookies(),
    os: 'android',
    appver: '9.5.05',
    channel: 'netease',
    buildver: '260427110037',
    versioncode: '9005005',
  }

  for (const [name, value] of Object.entries(cookies).filter(([key, item]) => key && item)) {
    try {
      await partnerSession.cookies.set({
        url: 'https://music.163.com',
        name,
        value,
        domain: '.music.163.com',
        path: '/',
        httpOnly: false,
        secure: true,
      })
    } catch (error) {
      logger.error('[MusicPartner] Cookie set failed:', name, error.message)
    }
  }
}

async function createMusicPartnerWindow(options = {}) {
  const electron = options.BrowserWindow && options.app ? null : require('electron')
  const BrowserWindow = options.BrowserWindow || electron.BrowserWindow
  const app = options.app || electron.app
  const cookieStore = options.cookieStore
  const createBridgeScript = options.createBridgeScript || createMusicPartnerBridgeScript
  const fs = options.fs || nodeFs
  const logger = options.logger || console
  const path = options.path || nodePath
  const randomUUID = options.randomUUID || nodeCrypto.randomUUID
  const partition = options.partition || 'persist:music-partner'
  const showOnReady = options.showOnReady !== false

  if (!cookieStore) throw new Error('createMusicPartnerWindow: cookieStore is required')
  if (!BrowserWindow || !app) throw new Error('createMusicPartnerWindow: Electron app and BrowserWindow are required')

  const bridgeScript = createBridgeScript({
    nickname: cookieStore.getNickname() || '',
    userId: cookieStore.getUserId() || '',
  })
  const preloadPath = path.join(app.getPath('temp'), `music-partner-bridge-preload-${randomUUID()}.js`)
  fs.writeFileSync(preloadPath, bridgeScript, 'utf8')

  const browserWindow = new BrowserWindow({
    width: 400,
    height: 750,
    minWidth: 375,
    minHeight: 667,
    title: 'Music Partner',
    icon: options.iconPath || path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false,
      partition,
      preload: preloadPath,
    },
    show: false,
  })

  const partnerSession = browserWindow.webContents.session
  await configureSession(partnerSession, cookieStore, logger)

  browserWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  for (const eventName of ['will-navigate', 'will-redirect']) {
    browserWindow.webContents.on(eventName, (event, targetUrl) => {
      if (!isAllowedPartnerNavigation(targetUrl)) event.preventDefault()
    })
  }

  browserWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) logger.log(`[Renderer:${level === 3 ? 'ERR' : 'WRN'}]`, String(message).substring(0, 500))
  })

  const injectBridge = label => {
    if (browserWindow.isDestroyed()) return
    browserWindow.webContents.executeJavaScript(bridgeScript)
      .then(() => logger.log('[MusicPartner] bridge injected:', label))
      .catch(error => logger.warn('[MusicPartner] bridge injection failed:', label, error.message))
  }
  browserWindow.webContents.on('did-navigate', () => injectBridge('did-navigate'))
  browserWindow.webContents.on('did-navigate-in-page', () => injectBridge('did-navigate-in-page'))
  browserWindow.webContents.on('did-finish-load', () => injectBridge('did-finish-load'))
  browserWindow.webContents.on('dom-ready', () => injectBridge('dom-ready'))

  if (showOnReady) browserWindow.on('ready-to-show', () => browserWindow.show())
  await browserWindow.loadURL(MUSIC_PARTNER_URL, { userAgent: MUSIC_PARTNER_UA })

  let cleanupPromise = null
  function cleanup({ clearStorage = false } = {}) {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      if (!browserWindow.isDestroyed()) browserWindow.destroy()
      if (clearStorage && partnerSession.clearStorageData) await partnerSession.clearStorageData()
      try {
        await fs.promises.unlink(preloadPath)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    })()
    return cleanupPromise
  }

  return {
    browserWindow,
    cleanup,
    destroy: () => cleanup(),
    focus: () => { if (!browserWindow.isDestroyed()) browserWindow.focus() },
    partition,
    preloadPath,
    show: () => { if (!browserWindow.isDestroyed()) browserWindow.show() },
  }
}

module.exports = {
  MUSIC_PARTNER_UA,
  MUSIC_PARTNER_URL,
  configureSession,
  createMusicPartnerWindow,
}
