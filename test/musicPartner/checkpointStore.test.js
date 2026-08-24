'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createCheckpointStore } = require('../../electron/musicPartner/checkpointStore')

function memoryStore() {
  const values = new Map()
  return {
    get(key) { return values.get(key) },
    set(key, value) { values.set(key, value) },
    delete(key) { values.delete(key) },
  }
}

test('checkpoint store persists and reads a checkpoint for the current date', () => {
  const backend = memoryStore()
  const checkpoints = createCheckpointStore({ backend, dateKey: () => '2026-07-23', now: () => 123 })

  const saved = checkpoints.save({
    phase: 'daily',
    confirmedCompleted: 2,
    currentSongId: 'song-3',
    plannedScore: { overall: 4, parts: { '旋律': 3 } },
    lastConfirmedBoundary: 'song-2',
  })

  assert.deepEqual(saved, {
    version: 1,
    dateKey: '2026-07-23',
    phase: 'daily',
    confirmedCompleted: 2,
    currentSongId: 'song-3',
    plannedScore: { overall: 4, parts: { '旋律': 3 } },
    lastConfirmedBoundary: 'song-2',
    updatedAt: 123,
  })
  assert.deepEqual(checkpoints.load(), saved)
})

test('checkpoint store ignores a checkpoint from a previous date', () => {
  const backend = memoryStore()
  backend.set('music-partner-rating-checkpoint', { version: 1, dateKey: '2026-07-22', phase: 'daily' })
  const checkpoints = createCheckpointStore({ backend, dateKey: () => '2026-07-23' })

  assert.equal(checkpoints.load(), null)
})

test('checkpoint store rejects invalid progress instead of persisting it', () => {
  const checkpoints = createCheckpointStore({ backend: memoryStore(), dateKey: () => '2026-07-23' })

  assert.throws(() => checkpoints.save({ phase: 'daily', confirmedCompleted: -1 }), /confirmedCompleted/)
  assert.equal(checkpoints.load(), null)
})

test('checkpoint store surfaces backend write failures', () => {
  const checkpoints = createCheckpointStore({
    backend: { get() {}, set() { throw new Error('disk full') }, delete() {} },
    dateKey: () => '2026-07-23',
  })

  assert.throws(() => checkpoints.save({ phase: 'daily', confirmedCompleted: 0 }), /disk full/)
})
