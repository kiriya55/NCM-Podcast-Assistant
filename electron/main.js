// Windows 下 stdout 管道可能断开导致 EPIPE 崩溃，忽略该错误
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})
process.on('warning', (warning) => {
  if (warning?.name === 'DeprecationWarning' && warning?.code === 'DEP0040') return
  console.warn(warning)
})

const { app, BrowserWindow, ipcMain, dialog } = require('electron')

const path = require('path')
const AuthService = require('./services/auth')
const PodcastService = require('./services/podcast')
const CookieStore = require('./services/cookieStore')
const LLMService = require('./services/llm')
const SettingsStore = require('./services/settingsStore')
const MusicPartnerService = require('./services/musicPartner')
const { proxyMusicPartnerRequest } = require('./services/musicPartnerProxy')
const { createCheckpointStore } = require('./musicPartner/checkpointStore')
const { createMusicPartnerRunController } = require('./musicPartner/runController')
const { createMusicPartnerWindow: createManagedMusicPartnerWindow } = require('./musicPartner/window')
const ElectronStore = require('electron-store')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let mainWindow = null
let musicPartnerWindow = null
let musicPartnerWindowHandle = null
let authService = null
let podcastService = null
let cookieStore = null
let llmService = null
let settingsStore = null
let musicPartnerService = null
let musicPartnerCheckpointStore = null
let musicPartnerRunController = null

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
    mainWindow.loadURL('http://127.0.0.1:5173').catch(() => {
      mainWindow.loadFile(distFile).catch(() => {
        mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
          '<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f5f5f5"><div style="text-align:center"><h2>开发服务器未启动</h2><p>请先运行 <code style="background:#eee;padding:4px 8px;border-radius:4px">npm run dev</code></p><p style="color:#999;font-size:13px">或先执行 <code style="background:#eee;padding:4px 8px;border-radius:4px">npm run build</code> 再运行 <code style="background:#eee;padding:4px 8px;border-radius:4px">electron .</code></p></div></body></html>'
        ))
      })
    })
    mainWindow.webContents.on('did-fail-load', (_e, code) => {
      if (code === -102 || code === -105) {
        console.log('[Main] Dev server unavailable, loading dist')
        mainWindow.loadFile(distFile).catch(() => {
          mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
            '<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f5f5f5"><div style="text-align:center"><h2>开发服务器未启动</h2><p>请先运行 <code style="background:#eee;padding:4px 8px;border-radius:4px">npm run dev</code></p></div></body></html>'
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
  musicPartnerCheckpointStore = createCheckpointStore({
    backend: new ElectronStore({ name: 'music-partner-automation' }),
  })
  musicPartnerRunController = createMusicPartnerRunController({
    checkpointStore: musicPartnerCheckpointStore,
    ensureWindow: () => ensureMusicPartnerWindow({ showOnReady: true }),
    destroyWindow: async (handle) => {
      await handle.cleanup()
      if (musicPartnerWindowHandle === handle) {
        musicPartnerWindowHandle = null
        musicPartnerWindow = null
      }
    },
    emit: (state) => mainWindow?.webContents.send('mp-automation-state', state),
  })
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
        { name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] },
      ],
    })
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle('select-cover-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
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
      filters: [{ name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    })
    if (result.canceled) return { success: false }

    const res = await fetch(url)
    if (!res.ok) throw new Error('下载失败: HTTP ' + res.status)
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
      // 从 data URI 中提取 MIME 类型
      const mimeMatch = imageBufferBase64.match(/^data:([^;]+);base64,/)
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
      // 将 base64 转回 Buffer
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
      await ensureMusicPartnerWindow({ showOnReady: true })
      return { success: true }
    } catch (err) {
      console.error('[MusicPartner] 打开失败:', err)
      throw err
    }
  })

  ipcMain.handle('open-music-partner-window', async () => {
    try {
      await ensureMusicPartnerWindow({ showOnReady: true })
      return { success: true }
    } catch (err) {
      console.error('[MusicPartner] open window failed:', err)
      throw err
    }
  })

  ipcMain.handle('mp-start-automation', async () => musicPartnerRunController.start())

  ipcMain.handle('mp-cancel-automation', async (_event, reason) => {
    return musicPartnerRunController.cancel(reason || '用户取消')
  })

  ipcMain.handle('mp-automation-status', async () => musicPartnerRunController.getStatus())

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

async function ensureMusicPartnerWindow({ showOnReady = true } = {}) {
  if (musicPartnerWindowHandle && !musicPartnerWindowHandle.browserWindow.isDestroyed()) {
    if (showOnReady) {
      musicPartnerWindowHandle.show()
      musicPartnerWindowHandle.focus()
    }
    return musicPartnerWindowHandle
  }

  if (musicPartnerWindowHandle) {
    await musicPartnerWindowHandle.cleanup().catch(error => {
      console.warn('[MusicPartner] stale window cleanup failed:', error.message)
    })
  }

  const handle = await createManagedMusicPartnerWindow({
    app,
    BrowserWindow,
    cookieStore,
    iconPath: path.join(__dirname, '..', 'build', 'icon.ico'),
    partition: 'persist:music-partner',
    showOnReady,
  })
  musicPartnerWindowHandle = handle
  musicPartnerWindow = handle.browserWindow

  handle.browserWindow.once('closed', () => {
    handle.cleanup().catch(error => console.warn('[MusicPartner] window cleanup failed:', error.message))
    if (musicPartnerWindowHandle === handle) musicPartnerWindowHandle = null
    if (musicPartnerWindow === handle.browserWindow) musicPartnerWindow = null
  })

  return handle
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
