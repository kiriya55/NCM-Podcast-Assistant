// Windows 下 stdout 管道可能断开导致 EPIPE 崩溃，忽略该错误
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})
process.on('warning', (warning) => {
  if (warning?.name === 'DeprecationWarning' && warning?.code === 'DEP0040') return
  console.warn(warning)
})

const { app, BrowserWindow, ipcMain, dialog, session } = require('electron')

const path = require('path')
const AuthService = require('./services/auth')
const PodcastService = require('./services/podcast')
const CookieStore = require('./services/cookieStore')
const LLMService = require('./services/llm')
const SettingsStore = require('./services/settingsStore')
const MusicPartnerService = require('./services/musicPartner')
const { proxyMusicPartnerRequest } = require('./services/musicPartnerProxy')
const { createMusicPartnerBridgeScript } = require('./musicPartnerBridge')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let mainWindow = null
let musicPartnerWindow = null
let authService = null
let podcastService = null
let cookieStore = null
let llmService = null
let settingsStore = null
let musicPartnerService = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'NCM-Podcast-Assistant',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
  })

  // Load Vite dev server in development, bundled files in production.
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
  const distFile = path.join(__dirname, '..', 'dist', 'index.html')
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow.loadFile(distFile).catch(() => {
        mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
          '<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f5f5f5"><div style="text-align:center"><h2>寮€鍙戞湇鍔″櫒鏈惎鍔?/h2><p>璇峰厛杩愯 <code style="background:#eee;padding:4px 8px;border-radius:4px">npm run dev</code></p><p style="color:#999;font-size:13px">鎴栧厛鎵ц <code style="background:#eee;padding:4px 8px;border-radius:4px">npm run build</code> 鍐嶈繍琛?<code style="background:#eee;padding:4px 8px;border-radius:4px">electron .</code></p></div></body></html>'
        ))
      })
    })
    mainWindow.webContents.on('did-fail-load', (_e, code) => {
      if (code === -102 || code === -105) {
        console.log('[Main] Dev server unavailable, loading dist')
        mainWindow.loadFile(distFile).catch(() => {
          mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
            '<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f5f5f5"><div style="text-align:center"><h2>寮€鍙戞湇鍔″櫒鏈惎鍔?/h2><p>璇峰厛杩愯 <code style="background:#eee;padding:4px 8px;border-radius:4px">npm run dev</code></p></div></body></html>'
          ))
        })
      }
    })
    if (process.env.OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools()
    }
  } else {
    mainWindow.loadFile(distFile)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function initServices() {
  cookieStore = new CookieStore()
  settingsStore = new SettingsStore()
  authService = new AuthService(cookieStore)
  podcastService = new PodcastService(cookieStore)
  llmService = new LLMService(settingsStore)
  musicPartnerService = new MusicPartnerService(cookieStore)
}

function registerIpcHandlers() {
  // === 登录 ===
  ipcMain.handle('get-qr-key', () => authService.getQRKey())

  ipcMain.handle('get-qr-code', (event, key) => authService.getQRCode(key))

  ipcMain.handle('check-qr-login', async (event, key) => {
    console.log('[Main] check-qr-login called')
    const result = await authService.checkQRLogin(key)
    console.log('[Main] check-qr-login result:', JSON.stringify(result))
    if (result.success) {
      podcastService.updateCookies(authService.getCookies())
      console.log('[Main] Cookies updated in podcastService')
    }
    return result
  })

  ipcMain.handle('send-captcha', (event, phone) => authService.sendCaptcha(phone))

  ipcMain.handle('verify-captcha', async (event, phone, captcha) => {
    const result = await authService.verifyCaptcha(phone, captcha)
    if (result.success) {
      podcastService.updateCookies(authService.getCookies())
    }
    return result
  })

  ipcMain.handle('check-login-status', () => {
    const token = cookieStore.getToken()
    if (!token) return { isLoggedIn: false }
    podcastService.updateCookies(authService.getCookies())
    return { isLoggedIn: true }
  })

  ipcMain.handle('logout', () => {
    authService.logout()
    return { success: true }
  })

  ipcMain.handle('get-user-info', async () => {
    console.log('[Main] get-user-info called')
    const info = await authService.getUserInfo()
    console.log('[Main] get-user-info result:', JSON.stringify(info))
    return info
  })

  // === 播客 ===
  ipcMain.handle('get-podcast-list', () => podcastService.getPodcastList())

  ipcMain.handle('get-episode-list', (event, programId) => podcastService.getEpisodeList(programId))

  ipcMain.handle('get-episode-list-paged', (event, programId, page, pageSize) => podcastService.getEpisodeListPaged(programId, page, pageSize))

  // === 上传 ===
  ipcMain.handle('upload-audio', async (event, programId, filePath, metadata) => {
    console.log('[Main] upload-audio called, programId:', programId, 'filePath:', filePath, 'metadata:', JSON.stringify(metadata))
    if (!filePath || filePath === 'undefined') {
      throw new Error('Audio file path is empty')
    }
    return podcastService.uploadAudio(programId, filePath, metadata, (progress) => {
      mainWindow?.webContents.send('upload-progress', progress)
    })
  })

  ipcMain.handle('submit-episode', (event, programId, episodeData) => podcastService.submitEpisode(programId, episodeData))

  ipcMain.handle('upload-batch', async (event, programId, fileList) => {
    const results = []
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i]
      mainWindow?.webContents.send('upload-progress', {
        fileName: file.name,
        current: i + 1,
        total: fileList.length,
        stage: 'uploading',
        progress: 0,
      })
      try {
        const result = await podcastService.uploadAudio(programId, file.path, file.metadata, (progress) => {
          mainWindow?.webContents.send('upload-progress', {
            fileName: file.name,
            current: i + 1,
            total: fileList.length,
            stage: 'uploading',
            progress,
          })
        })
        results.push({ success: true, fileName: file.name, result })
      } catch (err) {
        results.push({ success: false, fileName: file.name, error: err.message })
      }
    }
    return results
  })

  // === 文件选择 ===
  ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '闊抽鏂囦欢', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] },
      ],
    })
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle('select-cover-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '鍥剧墖鏂囦欢', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
      ],
    })
    if (result.canceled) return []
    return result.filePaths
  })

  // 读取图片文件返回 base64
  ipcMain.handle('read-image-base64', async (event, filePath) => {
    try {
      const buffer = await require('fs').promises.readFile(filePath)
      const ext = path.extname(filePath).toLowerCase().replace('.', '')
      const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
      const mime = mimeMap[ext] || 'image/jpeg'
      return `data:${mime};base64,${buffer.toString('base64')}`
    } catch (err) {
      return null
    }
  })

  ipcMain.handle('download-image', async (event, url, defaultFilename) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultFilename || 'cover.jpg',
      filters: [{ name: '鍥剧墖鏂囦欢', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    })
    if (result.canceled) return { success: false }

    const res = await fetch(url)
    if (!res.ok) throw new Error('涓嬭浇澶辫触: HTTP ' + res.status)
    const buffer = Buffer.from(await res.arrayBuffer())
    require('fs').writeFileSync(result.filePath, buffer)
    return { success: true, path: result.filePath }
  })

  // === 封面 ===
  ipcMain.handle('extract-cover', async (event, filePath) => {
    try {
      const cover = podcastService.extractCoverFromAudio(filePath)
      if (!cover) return null
      // Return base64 for frontend preview.
      return {
        base64: `data:${cover.mime};base64,${cover.buffer.toString('base64')}`,
        mime: cover.mime,
        size: cover.size,
      }
    } catch (err) {
      console.error('[Main] extract-cover error:', err.message)
      return null
    }
  })

  ipcMain.handle('batch-extract-covers', async (event, filePaths) => {
    const results = {}
    for (const fp of filePaths) {
      try {
        const cover = podcastService.extractCoverFromAudio(fp)
        if (cover) {
          results[fp] = {
            base64: `data:${cover.mime};base64,${cover.buffer.toString('base64')}`,
            mime: cover.mime,
            size: cover.size,
          }
        } else {
          results[fp] = null
        }
      } catch {
        results[fp] = null
      }
    }
    return results
  })

  ipcMain.handle('batch-extract-tags', async (event, filePaths) => {
    const results = {}
    for (const fp of filePaths) {
      try {
        const { tags, hasCover } = podcastService.extractAudioTags(fp)
        console.log('[Main] Extracted tags for:', fp, 'tags:', JSON.stringify(tags), 'hasCover:', hasCover)
        results[fp] = { tags, hasCover }
      } catch (err) {
        console.error('[Main] Tag extraction failed for:', fp, err.message)
        results[fp] = { tags: {}, hasCover: false }
      }
    }
    return results
  })

  // 合并提取标签和封面，避免重复读取文件
  ipcMain.handle('batch-extract-metadata', async (event, filePaths) => {
    const results = {}
    for (const fp of filePaths) {
      try {
        const { cover, tags } = podcastService.extractFullMetadata(fp)
        results[fp] = {
          tags: Object.keys(tags).length > 0 ? tags : null,
          cover: cover ? {
            base64: `data:${cover.mime};base64,${cover.buffer.toString('base64')}`,
            mime: cover.mime,
            size: cover.size,
          } : null,
        }
      } catch (err) {
        console.error('[Main] Metadata extraction failed for:', fp, err.message)
        results[fp] = { tags: null, cover: null }
      }
    }
    return results
  })

  ipcMain.handle('upload-cover', async (event, imageBufferBase64, fileName) => {
    try {
      // 浠?data URI 涓彁鍙?MIME 绫诲瀷
      const mimeMatch = imageBufferBase64.match(/^data:([^;]+);base64,/)
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
      // 灏?base64 杞洖 Buffer
      const base64Data = imageBufferBase64.replace(/^data:[^;]+;base64,/, '')
      const buffer = Buffer.from(base64Data, 'base64')
      return await podcastService.uploadCoverImage(buffer, fileName, mime)
    } catch (err) {
      console.error('[Main] upload-cover error:', err.message)
      throw new Error(err.message)
    }
  })

  ipcMain.handle('update-voice-cover', (event, voiceId, coverImgId, voiceListId) => podcastService.updateVoiceCover(voiceId, coverImgId, voiceListId))

  ipcMain.handle('update-podcast-cover', (event, voiceListId, coverImgId) => podcastService.updatePodcastCover(voiceListId, coverImgId))

  // === 管理 ===
  ipcMain.handle('update-voice', (event, voiceId, updates) => podcastService.updateVoice(voiceId, updates))

  ipcMain.handle('delete-voice', (event, voiceListId, voiceIds) => podcastService.deleteVoice(voiceListId, voiceIds))

  ipcMain.handle('get-voice-detail', (event, voiceId) => podcastService.getVoiceDetail(voiceId))

  // === LLM ===
  ipcMain.handle('parse-with-llm', (event, text, template) => llmService.parseSongInfo(text, template))

  // === 音乐合伙人 ===
  ipcMain.handle('mp-verify-user', async () => {
    return musicPartnerService.verifyUser()
  })

  ipcMain.handle('mp-run-all-tasks', async (event, scoreStrategy) => {
    return musicPartnerService.runAllTasks(scoreStrategy, (progress) => {
      mainWindow?.webContents.send('mp-progress', progress)
    })
  })

  ipcMain.handle('open-music-partner', async () => {
    try {
      await createMusicPartnerWindow()
      return { success: true }
    } catch (err) {
      console.error('[MusicPartner] 鎵撳紑澶辫触:', err)
      throw err
    }
  })

  ipcMain.handle('open-music-partner-window', async () => {
    try {
      await createMusicPartnerWindow()
      return { success: true }
    } catch (err) {
      console.error('[MusicPartner] open window failed:', err)
      throw err
    }
  })

  const { weapi } = require('./services/crypto')

  ipcMain.handle('encrypt-weapi', async (_event, data) => {
    try {
      const result = weapi(data)
      return { params: result.params, encSecKey: result.encSecKey }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle('get-cookie-string', async () => cookieStore.getCookieString())

  ipcMain.handle('proxy-request', async (_event, reqInfo) => {
    try {
      return await proxyMusicPartnerRequest(reqInfo, cookieStore)
    } catch (err) {
      console.error('[Main] proxy-request error:', err.message)
      return { status: -1, data: null, error: err.message }
    }
  })

  ipcMain.handle('capture-music-partner', async () => {
    if (!musicPartnerWindow || musicPartnerWindow.isDestroyed()) return null
    const image = await musicPartnerWindow.webContents.capturePage()
    const buffer = image.toPNG()
    const tmpPath = require('path').join(app.getPath('temp'), 'music-partner-screenshot.png')
    require('fs').writeFileSync(tmpPath, buffer)
    return tmpPath
  })

  // === 设置 ===
  ipcMain.handle('get-settings', () => {
    return settingsStore.getAll()
  })

  ipcMain.handle('save-settings', (event, settings) => {
    settingsStore.save(settings)
    llmService.updateConfig(settings)
    return { success: true }
  })
}

const MUSIC_PARTNER_URL = 'https://mp.music.163.com/68429fb40fd3640105f60c9a/home/index.html?isH5=1&nm_style=sbt&bounces=false'
const MUSIC_PARTNER_UA = 'Mozilla/5.0 (Linux; Android 12; V2309A Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.154 Safari/537.36 CloudMusic/0.1.2 NeteaseMusic/9.5.05'

function writeMusicPartnerBridgePreload() {
  const nickname = (cookieStore.getNickname() || '').replace(/'/g, "\\'").replace(/\\/g, '\\\\')
  const userId = cookieStore.getUserId() || ''
  const bridgePreloadPath = path.join(app.getPath('temp'), 'music-partner-bridge-preload.js')
  const bridgeScript = createMusicPartnerBridgeScript({ nickname, userId })
  require('fs').writeFileSync(bridgePreloadPath, bridgeScript, 'utf-8')
  return { bridgePreloadPath, bridgeScript }
}

async function setupMusicPartnerSession(partnerSession) {
  partnerSession.webRequest.onBeforeRequest(
    { urls: ['http://*.music.126.net/*', 'http://*.music.163.com/*'] },
    (details, callback) => {
      callback({ redirectURL: details.url.replace('http://', 'https://') })
    }
  )

  partnerSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://*.music.163.com/*', 'https://*.127.net/*', 'https://*.music.126.net/*'] },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://mp.music.163.com/'
      details.requestHeaders['User-Agent'] = MUSIC_PARTNER_UA
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  partnerSession.webRequest.onHeadersReceived(
    { urls: ['https://*.music.163.com/*', 'https://*.127.net/*', 'https://*.music.126.net/*'] },
    (details, callback) => {
      delete details.responseHeaders['access-control-allow-origin']
      delete details.responseHeaders['Access-Control-Allow-Origin']
      delete details.responseHeaders['access-control-allow-credentials']
      delete details.responseHeaders['Access-Control-Allow-Credentials']

      details.responseHeaders['Access-Control-Allow-Origin'] = ['https://mp.music.163.com']
      details.responseHeaders['Access-Control-Allow-Credentials'] = ['true']
      details.responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PUT, OPTIONS']
      details.responseHeaders['Access-Control-Allow-Headers'] = ['*']
      callback({ responseHeaders: details.responseHeaders })
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

  for (const [name, value] of Object.entries(cookies).filter(([k, v]) => k && v)) {
    await partnerSession.cookies.set({
      url: 'https://music.163.com',
      name,
      value,
      domain: '.music.163.com',
      path: '/',
      httpOnly: false,
      secure: true,
    }).catch((err) => console.error('[MusicPartner] Cookie set failed:', name, err.message))
  }
}

async function prepareMusicPartnerEmbedConfig() {
  const { bridgePreloadPath } = writeMusicPartnerBridgePreload()
  const partition = 'persist:music-partner'
  await setupMusicPartnerSession(session.fromPartition(partition))
  return {
    url: MUSIC_PARTNER_URL,
    preloadPath: bridgePreloadPath,
    partition,
    userAgent: MUSIC_PARTNER_UA,
  }
}

// 创建音乐合伙人H5窗口
async function createMusicPartnerWindow() {
  if (musicPartnerWindow && !musicPartnerWindow.isDestroyed()) {
    musicPartnerWindow.focus()
    return
  }

  // === 绗竴姝ワ細鍏堢敓鎴愬苟鍐欏ソ preload 鏂囦欢锛屽啀鍒涘缓 BrowserWindow ===
  const nickname = (cookieStore.getNickname() || '').replace(/'/g, "\\'").replace(/\\/g, '\\\\')
  const userId = cookieStore.getUserId() || ''
  const bridgePreloadPath = path.join(app.getPath('temp'), 'music-partner-bridge-preload.js')

  // bridge 脚本以 preload 方式注入，contextIsolation=false 时 require(electron) 可用
  const bridgeScript = createMusicPartnerBridgeScript({ nickname, userId })
  require('fs').writeFileSync(bridgePreloadPath, bridgeScript, 'utf-8')
  console.log('[MusicPartner] Bridge preload written:', bridgePreloadPath)

  // === 绗簩姝ワ細鍒涘缓绐楀彛锛屾鏃?preload 鏂囦欢宸插瓨鍦?===
  musicPartnerWindow = new BrowserWindow({
    width: 400,
    height: 750,
    minWidth: 375,
    minHeight: 667,
    title: 'Music Partner',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      preload: bridgePreloadPath,
    },
    show: false,
  })

  const partnerSession = musicPartnerWindow.webContents.session

  partnerSession.webRequest.onBeforeRequest(
    { urls: ['http://*.music.126.net/*', 'http://*.music.163.com/*'] },
    (details, callback) => {
      callback({ redirectURL: details.url.replace('http://', 'https://') })
    }
  )

  // 璁剧疆 Referer 鍜?User-Agent 澶撮儴
  partnerSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://*.music.163.com/*', 'https://*.127.net/*', 'https://*.music.126.net/*'] },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://mp.music.163.com/'
      details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Linux; Android 12; V2309A Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.154 Safari/537.36 CloudMusic/0.1.2 NeteaseMusic/9.5.05'
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  // Inject CORS response headers for music.163.com resources.
  partnerSession.webRequest.onHeadersReceived(
    { urls: ['https://*.music.163.com/*', 'https://*.127.net/*', 'https://*.music.126.net/*'] },
    (details, callback) => {
      delete details.responseHeaders['access-control-allow-origin']
      delete details.responseHeaders['Access-Control-Allow-Origin']
      delete details.responseHeaders['access-control-allow-credentials']
      delete details.responseHeaders['Access-Control-Allow-Credentials']

      details.responseHeaders['Access-Control-Allow-Origin'] = ['https://mp.music.163.com']
      details.responseHeaders['Access-Control-Allow-Credentials'] = ['true']
      details.responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PUT, OPTIONS']
      details.responseHeaders['Access-Control-Allow-Headers'] = ['*']
      callback({ responseHeaders: details.responseHeaders })
    }
  )

  // === 绗笁姝ワ細娉ㄥ叆 Cookie 瀹炵幇鐧诲綍鎬佸叡浜?===
  try {
    const cookies = {
      ...cookieStore.getCookies(),
      os: 'android',
      appver: '9.5.05',
      channel: 'netease',
      buildver: '260427110037',
      versioncode: '9005005',
    }
    const cookieEntries = Object.entries(cookies).filter(([k, v]) => k && v)

    console.log('[MusicPartner] CookieStore keys:', cookieEntries.map(([k]) => k).join(', '))
    console.log('[MusicPartner] MUSIC_U:', cookies['MUSIC_U'] ? 'exists' : 'MISSING')
    console.log('[MusicPartner] __csrf:', cookies['__csrf'] ? 'exists' : 'MISSING')

    for (const [name, value] of cookieEntries) {
      await partnerSession.cookies.set({
        url: 'https://music.163.com',
        name,
        value,
        domain: '.music.163.com',
        path: '/',
        httpOnly: false,
        secure: true,
      }).catch((err) => console.error('[MusicPartner] Cookie set failed:', name, err.message))
    }

    console.log('[MusicPartner] Cookie injection completed, count:', cookieEntries.length)
  } catch (err) {
    console.error('[MusicPartner] Cookie娉ㄥ叆澶辫触:', err)
  }

  // 鐩戝惉娓叉煋杩涚▼鏃ュ織锛堟墦鍗版墍鏈夋棩蹇椾究浜庤瘖鏂紝杩囨护鎺夊櫔闊崇骇鍒級
  musicPartnerWindow.webContents.on('console-message', (_e, level, msg) => {
    // level: 0=verbose, 1=info, 2=warning, 3=error
    if (level >= 2) {
      // warning/error 鍏ㄩ儴鎵撳嵃
      console.log('[Renderer:' + (level === 3 ? 'ERR' : 'WRN') + ']', msg.substring(0, 500))
    } else if (msg.indexOf('[BridgeMock]') !== -1 || msg.indexOf('MNB') !== -1) {
      console.log('[Renderer]', msg.substring(0, 500))
    } else if (msg.indexOf('partner') !== -1 || msg.indexOf('Partner') !== -1) {
      console.log('[Renderer:partner]', msg.substring(0, 500))
    }
  })

  const injectBridge = (label) => {
    if (!musicPartnerWindow || musicPartnerWindow.isDestroyed()) return
    musicPartnerWindow.webContents.executeJavaScript(bridgeScript)
      .then(() => console.log('[MusicPartner] bridge injected:', label))
      .catch((e) => { console.log('[MusicPartner] bridge inject failed:', label, e.message) })
  }

  musicPartnerWindow.webContents.on('did-navigate', () => injectBridge('did-navigate'))
  musicPartnerWindow.webContents.on('did-navigate-in-page', () => injectBridge('did-navigate-in-page'))
  musicPartnerWindow.webContents.on('did-finish-load', () => injectBridge('did-finish-load'))

  // dom-ready 兜底：preload 是最佳注入时机；如果 dom-ready 时 flag 缺失则补注入
  musicPartnerWindow.webContents.on('dom-ready', () => {
    const currentUrl = musicPartnerWindow.webContents.getURL()
    console.log('[MusicPartner] dom-ready, URL:', currentUrl.substring(0, 100))
    injectBridge('dom-ready')
    // Bridge diagnostics are disabled in normal builds.

  })

  // Load the music partner H5 page with an Android NetEase Music UA.
  musicPartnerWindow.loadURL('https://mp.music.163.com/68429fb40fd3640105f60c9a/home/index.html?isH5=1&nm_style=sbt&bounces=false', {
    userAgent: 'Mozilla/5.0 (Linux; Android 12; V2309A Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.154 Safari/537.36 CloudMusic/0.1.2 NeteaseMusic/9.5.05',
  })

  musicPartnerWindow.on('ready-to-show', () => {
    musicPartnerWindow.show()
  })

  musicPartnerWindow.on('closed', () => {
    musicPartnerWindow = null
  })
}

app.whenReady().then(() => {
  initServices()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
