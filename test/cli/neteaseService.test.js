'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const AuthService = require('../../electron/services/auth')
const PodcastService = require('../../electron/services/podcast')
const LLMService = require('../../electron/services/llm')
const MusicPartnerService = require('../../electron/services/musicPartner')
const { NeteaseService } = require('../../electron/services/neteaseService')
const { createCliServices } = require('../../electron/cli/storage')

function memoryCookieStore() {
  let cookies = {}
  return {
    getCookies: () => ({ ...cookies }),
    setCookies: (next) => { cookies = { ...next } },
    getCookieString: () => '',
  }
}

test('NeteaseService can update cookies without an Electron session', async () => {
  const service = new NeteaseService(memoryCookieStore(), { session: null })

  service.updateCookies({ MUSIC_U: 'token-value' })
  await service._syncCookiesToSession()

  assert.equal(service.getCookies().MUSIC_U, 'token-value')
})

test('createCliServices creates the complete service set against one data directory', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncm-cli-services-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

  const services = createCliServices({ dataDir, session: null })

  assert.equal(services.cookieStore.store.path, path.join(dataDir, 'cookies.json'))
  assert.equal(services.settingsStore.store.path, path.join(dataDir, 'settings.json'))
  assert.ok(services.authService instanceof AuthService)
  assert.ok(services.podcastService instanceof PodcastService)
  assert.ok(services.llmService instanceof LLMService)
  assert.ok(services.musicPartnerService instanceof MusicPartnerService)
})
