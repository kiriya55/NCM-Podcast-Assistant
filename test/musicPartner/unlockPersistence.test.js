'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

test('unlock persistence keeps activation when the UI creates a new session', async () => {
  const { createUnlockPersistence } = await import('../../src/components/MusicPartner/unlockStorage.mjs')
  const values = new Map()
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, value) },
    removeItem(key) { values.delete(key) },
  }

  const firstSession = createUnlockPersistence(storage)
  assert.equal(firstSession.isUnlocked(), false)

  firstSession.unlock()

  const secondSession = createUnlockPersistence(storage)
  assert.equal(secondSession.isUnlocked(), true)

  secondSession.lock()
  assert.equal(createUnlockPersistence(storage).isUnlocked(), false)
})
