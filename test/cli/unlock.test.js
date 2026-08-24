'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { validateMusicPartnerUnlock } = require('../../electron/cli/unlock')

function fakeFs(contents = null) {
  return {
    readFileSync() {
      if (contents === null) {
        const error = new Error('missing')
        error.code = 'ENOENT'
        throw error
      }
      return contents
    },
  }
}

test('unlock accepts matching runtime and environment values without returning either', () => {
  assert.equal(validateMusicPartnerUnlock({
    env: { NCM_MP_PASSWORD: 'same-value', VITE_MP_PASSWORD: 'same-value' },
    fs: fakeFs(),
  }), undefined)
})

test('unlock falls back to the project env file and parses a quoted value', () => {
  assert.doesNotThrow(() => validateMusicPartnerUnlock({
    env: { NCM_MP_PASSWORD: 'from-file' },
    envFile: 'D:\\project\\.env',
    fs: fakeFs('OTHER=value\nVITE_MP_PASSWORD="from-file"\n'),
  }))
})

test('unlock rejects missing and mismatched runtime values without exposing credentials', () => {
  for (const env of [
    { VITE_MP_PASSWORD: 'reference-secret' },
    { NCM_MP_PASSWORD: 'wrong-secret', VITE_MP_PASSWORD: 'reference-secret' },
  ]) {
    assert.throws(
      () => validateMusicPartnerUnlock({ env, fs: fakeFs() }),
      error => error.code === 'UNLOCK_FAILED'
        && !error.message.includes('wrong-secret')
        && !error.message.includes('reference-secret')
    )
  }
})
