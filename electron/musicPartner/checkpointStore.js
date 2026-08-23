'use strict'

const CHECKPOINT_KEY = 'music-partner-rating-checkpoint'
const CHECKPOINT_VERSION = 1

function defaultDateKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createCheckpointStore({ backend, dateKey = defaultDateKey, now = Date.now } = {}) {
  if (!backend || typeof backend.get !== 'function' || typeof backend.set !== 'function') {
    throw new Error('checkpoint store backend with get/set is required')
  }

  function load() {
    const value = backend.get(CHECKPOINT_KEY)
    if (!value || value.version !== CHECKPOINT_VERSION || value.dateKey !== dateKey()) return null
    return value
  }

  function save(value) {
    if (!value || !['daily', 'extra'].includes(value.phase)) throw new Error('checkpoint phase is invalid')
    if (!Number.isInteger(value.confirmedCompleted) || value.confirmedCompleted < 0) {
      throw new Error('checkpoint confirmedCompleted is invalid')
    }
    const checkpoint = {
      version: CHECKPOINT_VERSION,
      dateKey: dateKey(),
      phase: value.phase,
      confirmedCompleted: value.confirmedCompleted,
      currentSongId: value.currentSongId || null,
      plannedScore: value.plannedScore || null,
      lastConfirmedBoundary: value.lastConfirmedBoundary || null,
      updatedAt: now(),
    }
    backend.set(CHECKPOINT_KEY, checkpoint)
    return checkpoint
  }

  function clear() {
    if (typeof backend.delete === 'function') backend.delete(CHECKPOINT_KEY)
  }

  return { load, save, clear }
}

module.exports = { createCheckpointStore, CHECKPOINT_KEY, CHECKPOINT_VERSION }
