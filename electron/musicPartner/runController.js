'use strict'

const { createMusicPartnerAutomation, DEFAULT_TIMING } = require('./automation')
const { createPageAdapter } = require('./pageAdapter')
const { createRandomBalancedStrategy } = require('./scoreStrategy')

const IDLE_STATUS = Object.freeze({
  status: 'idle',
  phase: null,
  current: 0,
  total: 0,
  action: '',
  remainingMs: null,
  score: null,
  error: null,
  reasonCode: null,
  progressKnown: true,
})

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isManualIntervention(result) {
  return result?.reasonCode === 'manual-intervention-required'
    || /manual intervention required/i.test(result?.reason || '')
}

function createMusicPartnerRunController({
  ensureWindow,
  destroyWindow,
  checkpointStore,
  emit = () => {},
  createAdapter = createPageAdapter,
  createAutomation = createMusicPartnerAutomation,
  createStrategy = createRandomBalancedStrategy,
  timing = DEFAULT_TIMING,
  maxRestarts = 2,
  restartDelayMs = 2000,
  sleep = defaultSleep,
  logger = console,
}) {
  if (typeof ensureWindow !== 'function') throw new Error('createMusicPartnerRunController: ensureWindow is required')
  if (typeof destroyWindow !== 'function') throw new Error('createMusicPartnerRunController: destroyWindow is required')

  let activeAutomation = null
  let busy = false
  let cancelRequested = false
  let cancelReason = 'Cancelled'
  let currentHandle = null
  let lastStatus = { ...IDLE_STATUS }

  function emitState(state) {
    lastStatus = { ...lastStatus, ...state }
    emit(lastStatus)
  }

  async function start() {
    if (busy) return { success: false, code: 'already-running' }
    busy = true
    cancelRequested = false
    cancelReason = 'Cancelled'

    try {
      let lastResult = null
      for (let attempt = 0; attempt <= maxRestarts; attempt += 1) {
        if (cancelRequested) return { success: false, code: 'cancelled', reason: cancelReason }

        currentHandle = await ensureWindow()
        const browserWindow = currentHandle.browserWindow
        const adapter = createAdapter({
          getWebContents: () => browserWindow && !browserWindow.isDestroyed() ? browserWindow.webContents : null,
          getUrl: () => browserWindow && !browserWindow.isDestroyed() ? browserWindow.webContents.getURL() : '',
        })

        activeAutomation = createAutomation({
          adapter,
          strategy: createStrategy(),
          timing,
          emit: emitState,
          checkpointStore,
        })

        if (cancelRequested) activeAutomation.cancel(cancelReason)
        lastResult = await activeAutomation.start()

        if (cancelRequested) {
          return { success: false, code: 'cancelled', reason: cancelReason }
        }
        if (lastResult?.success || isManualIntervention(lastResult) || attempt >= maxRestarts) {
          return lastResult
        }

        logger.warn(`[MusicPartner] automation paused; recreating window (${attempt + 1}/${maxRestarts})`, lastResult?.reason || '')
        emitState({
          status: 'paused',
          action: `页面异常，正在重启重试（${attempt + 1}/${maxRestarts}）`,
          error: lastResult?.reason || 'automation failed',
          remainingMs: null,
          score: null,
        })
        await destroyWindow(currentHandle)
        currentHandle = null
        await sleep(restartDelayMs)
      }

      return lastResult || { success: false, code: 'automation-failed' }
    } finally {
      activeAutomation = null
      busy = false
      cancelRequested = false
    }
  }

  function cancel(reason = 'Cancelled') {
    if (!busy) return { success: false, code: 'not-running' }
    cancelRequested = true
    cancelReason = reason
    if (activeAutomation) activeAutomation.cancel(reason)
    return { success: true }
  }

  function getStatus() {
    return activeAutomation ? activeAutomation.getStatus() : { ...lastStatus }
  }

  return {
    cancel,
    getStatus,
    getWindowHandle: () => currentHandle,
    isRunning: () => busy,
    start,
  }
}

module.exports = { IDLE_STATUS, createMusicPartnerRunController, isManualIntervention }
