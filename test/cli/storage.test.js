'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CookieStore = require('../../electron/services/cookieStore')
const SettingsStore = require('../../electron/services/settingsStore')
const { resolveDataDir } = require('../../electron/cli/storage')

test('resolveDataDir matches Electron userData locations on each platform', () => {
  assert.equal(
    resolveDataDir({
      env: { APPDATA: 'C:\\Users\\Roy\\AppData\\Roaming' },
      platform: 'win32',
      homeDir: 'C:\\Users\\Roy',
    }),
    'C:\\Users\\Roy\\AppData\\Roaming\\NCM-Podcast-Assistant'
  )

  assert.equal(
    resolveDataDir({ env: {}, platform: 'darwin', homeDir: '/Users/roy' }),
    '/Users/roy/Library/Application Support/NCM-Podcast-Assistant'
  )

  assert.equal(
    resolveDataDir({ env: {}, platform: 'linux', homeDir: '/home/roy' }),
    '/home/roy/.config/NCM-Podcast-Assistant'
  )
})

test('resolveDataDir honors NCM_DATA_DIR before platform defaults', () => {
  assert.equal(
    resolveDataDir({
      env: { NCM_DATA_DIR: 'D:\\portable\\ncm' },
      platform: 'win32',
      homeDir: 'C:\\Users\\Roy',
    }),
    'D:\\portable\\ncm'
  )
})

test('CookieStore and SettingsStore persist through an explicit directory', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ncm-cli-store-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))

  new CookieStore({ cwd }).setToken('token-value')
  new SettingsStore({ cwd }).save({ openaiModel: 'model-value' })

  assert.equal(new CookieStore({ cwd }).getToken(), 'token-value')
  assert.equal(new SettingsStore({ cwd }).get('openaiModel'), 'model-value')
})
