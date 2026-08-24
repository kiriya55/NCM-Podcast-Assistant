'use strict'

const os = require('node:os')
const path = require('node:path')

const AuthService = require('../services/auth')
const CookieStore = require('../services/cookieStore')
const LLMService = require('../services/llm')
const MusicPartnerService = require('../services/musicPartner')
const PodcastService = require('../services/podcast')
const SettingsStore = require('../services/settingsStore')

const APP_NAME = 'NCM-Podcast-Assistant'

function resolveDataDir({
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
} = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix

  if (env.NCM_DATA_DIR) {
    return pathApi.resolve(env.NCM_DATA_DIR)
  }

  if (platform === 'win32') {
    const appData = env.APPDATA || path.win32.join(homeDir, 'AppData', 'Roaming')
    return path.win32.join(appData, APP_NAME)
  }

  if (platform === 'darwin') {
    return path.posix.join(homeDir, 'Library', 'Application Support', APP_NAME)
  }

  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(homeDir, '.config'), APP_NAME)
}

function createCliServices({ dataDir = resolveDataDir(), session = null } = {}) {
  const cookieStore = new CookieStore({ cwd: dataDir })
  const settingsStore = new SettingsStore({ cwd: dataDir })

  return {
    cookieStore,
    settingsStore,
    authService: new AuthService(cookieStore, { session }),
    podcastService: new PodcastService(cookieStore, { session }),
    llmService: new LLMService(settingsStore),
    musicPartnerService: new MusicPartnerService(cookieStore),
  }
}

module.exports = { APP_NAME, createCliServices, resolveDataDir }
