'use strict'

const { assertScoreResult } = require('./scoreStrategy')

const DEFAULT_TIMING = Object.freeze({
  requiredPlaybackMs: 15_000,
  afterPlaybackMs: Object.freeze([2_000, 6_000]),
  betweenScoresMs: Object.freeze([400, 1_200]),
  beforeSubmitMs: Object.freeze([1_000, 3_000]),
})

const DAILY_TOTAL = 5
const EXTRA_TOTAL = 15

function createMusicPartnerAutomation(deps) {
  if (!deps || typeof deps.emit !== 'function') {
    throw new Error('createMusicPartnerAutomation: emit is required')
  }
  if (!deps.adapter || typeof deps.adapter.inspect !== 'function') {
    throw new Error('createMusicPartnerAutomation: adapter is required')
  }
  if (!deps.strategy || typeof deps.strategy.score !== 'function') {
    throw new Error('createMusicPartnerAutomation: strategy.score is required')
  }
  const emit = deps.emit
  const adapter = deps.adapter
  const strategy = deps.strategy
  const timing = deps.timing || DEFAULT_TIMING
  const nowFn = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const randomFn = typeof deps.random === 'function' ? deps.random : Math.random
  const sleepFn = typeof deps.sleep === 'function' ? deps.sleep : defaultSleep

  let runState = {
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
  }
  let running = false
  let abortController = null
  let cancelReason = null

  function defaultSleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(new Error('aborted'))
        return
      }
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      function onAbort() {
        clearTimeout(timer)
        reject(new Error('aborted'))
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  function emitState(overrides) {
    runState = { ...runState, ...(overrides || {}) }
    emit({ ...runState })
  }

  function randomInRange(range) {
    const [min, max] = range
    return Math.floor(randomFn() * (max - min + 1)) + min
  }

  async function sleep(ms, signal, action) {
    emitState({ remainingMs: ms, action })
    try {
      await sleepFn(ms, signal)
    } finally {
      emitState({ remainingMs: null })
    }
  }

  function failPaused(reason, details) {
    if (abortController) {
      try { abortController.abort() } catch (_) {}
      abortController = null
    }
    running = false
    emitState({ status: 'paused', error: reason, remainingMs: null, ...(details || {}) })
    return { success: false, code: 'paused', reason }
  }

  async function inspectSafe() {
    try {
      return await adapter.inspect()
    } catch (err) {
      return { kind: 'blocked', reason: 'inspect-threw: ' + (err && err.message || err) }
    }
  }

  async function dismissOverlayIfNeeded() {
    // add some func
    let attempts = 0
    while (attempts < 5) {
      const state = await inspectSafe()
      if (state.kind === 'intervention') {
        throw new Error('manual intervention required: ' + (state.interventionType || 'unknown-intervention'))
      }
      if (state.kind !== 'overlay') return state

      attempts++
      emitState({ action: '关闭弹窗中 (' + attempts + ')' })

      if (typeof adapter.dismissOverlay === 'function') {
        const result = await adapter.dismissOverlay()
        if (!result || result.ok !== true) {
          // add some func
          await sleepFn(500)
          continue
        }
        // add some func
        await sleepFn(300)
      } else {
        // add some func
        break
      }
    }
    return await inspectSafe()
  }

  async function waitForStablePage(signal) {
    let state = await dismissOverlayIfNeeded()
    let attempts = 0
    while ((state.kind === 'loading' || (state.kind === 'blocked' && state.reason === 'unknown-page')) && attempts < 20) {
      attempts++
      await sleepFn(300, signal)
      state = await dismissOverlayIfNeeded()
    }
    return state
  }

  async function waitForPlaybackGate(state, expectedSongId, signal) {
    // add some func
    let observedMs = 0
    let lastCurrentTimeSec = -1
    let stablePollsAtSameTime = 0
    while (observedMs < timing.requiredPlaybackMs) {
      const re = await inspectSafe()
      if (re.kind !== 'rating') {
        throw new Error('playback-gate: page left rating state (' + re.kind + (re.reason ? ' / ' + re.reason : '') + ')')
      }
      if (re.songId !== expectedSongId) {
        throw new Error('playback-gate: songId changed during wait (expected ' + expectedSongId + ', got ' + re.songId + ')')
      }
      if (!re.playback || !re.playback.available) {
        throw new Error('playback-gate: playback not available')
      }
      if (!re.playback.playing) {
        throw new Error('playback-gate: playback stopped during wait')
      }
      const ctSec = re.playback.currentTime || 0
      if (lastCurrentTimeSec < 0) {
        lastCurrentTimeSec = ctSec
        stablePollsAtSameTime = 0
      } else {
        const deltaSec = ctSec - lastCurrentTimeSec
        if (deltaSec > 0) {
          observedMs += Math.round(deltaSec * 1000)
          lastCurrentTimeSec = ctSec
          stablePollsAtSameTime = 0
        } else if (deltaSec === 0) {
          stablePollsAtSameTime++
          if (stablePollsAtSameTime > 30 && observedMs === 0) {
            throw new Error('playback-gate: playback not advancing')
          }
        } else {
          throw new Error('playback-gate: playback position regressed')
        }
      }
      emitState({
        action: '播放等待 ' + Math.round(observedMs / 1000) + '/' + Math.round(timing.requiredPlaybackMs / 1000),
        remainingMs: Math.max(0, timing.requiredPlaybackMs - observedMs),
      })
      // add some func
      try {
        await sleepFn(500, signal)
      } catch (e) {
        throw new Error('playback-gate: wait aborted')
      }
    }
  }

  async function clickScoreWithFail(label, score, signal) {
    emitState({ action: '评分中: ' + label + ' ' + score })
    const result = await adapter.clickScore(label, score)
    if (!result || result.ok !== true) {
      const reason = (result && result.reason) || 'unknown'
      throw new Error('clickScore failed for ' + label + ': ' + reason)
    }
    if (typeof result.confirmedScore !== 'number' || result.confirmedScore !== score) {
      throw new Error('clickScore not confirmed for ' + label + ' (expected ' + score + ', got ' + result.confirmedScore + ')')
    }
    return result
  }

  async function rateAndSubmit(song, partNames, phase, songIndex, signal) {
    emitState({ action: '生成评分方案' })
    const ctx = { phase, songIndex, song, partNames }
    let result
    const stored = deps.checkpointStore && deps.checkpointStore.load()
    if (stored && stored.phase === phase && stored.currentSongId === song.songId && stored.plannedScore) {
      result = stored.plannedScore
    } else {
      try {
        result = strategy.score(ctx)
      } catch (err) {
        throw new Error('strategy.score threw: ' + (err && err.message || err))
      }
    }
    try {
      assertScoreResult(result, partNames)
    } catch (err) {
      throw new Error('strategy returned invalid result: ' + (err && err.message || err))
    }
    emitState({ score: { overall: result.overall, parts: { ...result.parts } } })
    if (deps.checkpointStore) {
      deps.checkpointStore.save({
        phase,
        confirmedCompleted: songIndex,
        currentSongId: song.songId,
        plannedScore: result,
        lastConfirmedBoundary: stored && stored.lastConfirmedBoundary,
      })
    }

    // add some func
    await sleep(randomInRange(timing.afterPlaybackMs), signal, '播放后等待')

    // add some func
    await clickScoreWithFail('总评', result.overall, signal)
    const afterOverall = await inspectSafe()
    if (afterOverall.kind !== 'rating' || afterOverall.songId !== song.songId) {
      throw new Error('rating page changed after overall score')
    }
    const revealedPartNames = afterOverall.partNames
    if (revealedPartNames.length !== partNames.length || revealedPartNames.some((name, index) => name !== partNames[index])) {
      try {
        result = strategy.score({ phase, songIndex, song, partNames: revealedPartNames, overallScore: result.overall })
      } catch (err) {
        throw new Error('strategy.score threw for revealed parts: ' + (err && err.message || err))
      }
      try {
        assertScoreResult(result, revealedPartNames)
      } catch (err) {
        throw new Error('strategy returned invalid revealed parts: ' + (err && err.message || err))
      }
      emitState({ score: { overall: result.overall, parts: { ...result.parts } } })
      if (deps.checkpointStore) {
        deps.checkpointStore.save({
          phase,
          confirmedCompleted: songIndex,
          currentSongId: song.songId,
          plannedScore: result,
          lastConfirmedBoundary: stored && stored.lastConfirmedBoundary,
        })
      }
    }
    if (revealedPartNames.length > 0) {
      await sleep(randomInRange(timing.betweenScoresMs), signal, '分项间等待')
    }
    for (let i = 0; i < revealedPartNames.length; i++) {
      const name = revealedPartNames[i]
      await clickScoreWithFail(name, result.parts[name], signal)
      if (i < revealedPartNames.length - 1) {
        await sleep(randomInRange(timing.betweenScoresMs), signal, '分项间等待')
      }
    }

    // add some func
    await sleep(randomInRange(timing.beforeSubmitMs), signal, '提交前等待')

    emitState({ action: '提交评分' })
    const submitResult = await adapter.submitCurrentSong()
    if (!submitResult || submitResult.ok !== true) {
      const reason = (submitResult && submitResult.reason) || 'unknown'
      throw new Error('submitCurrentSong failed: ' + reason)
    }
  }

  async function confirmTransition(expectedSongId, signal) {
    // 提交后切歌会经历 loading / unknown-page 等短暂中间态，不能直接当作异常。
    let attempts = 0
    const MAX_TRANSITION_ATTEMPTS = 40
    while (attempts < MAX_TRANSITION_ATTEMPTS) {
      attempts++
      const re = await inspectSafe()
      if (re.kind === 'home') return { kind: 'home' }
      if (re.kind === 'stage-complete') return { kind: 'stage-complete', phase: re.phase }
      if (re.kind === 'rating' && re.songId !== expectedSongId) {
        return { kind: 'rating', songId: re.songId }
      }
      if (re.kind === 'loading' || (re.kind === 'blocked' && re.reason === 'unknown-page')) {
        try {
          await sleepFn(300, signal)
        } catch (e) {
          throw new Error('transition wait aborted')
        }
        continue
      }
      if (re.kind === 'blocked') {
        throw new Error('transition blocked: ' + (re.reason || 'unknown'))
      }
      try {
        await sleepFn(300, signal)
      } catch (e) {
        throw new Error('transition wait aborted')
      }
    }
    const error = new Error('transition 无法确认：提交后页面长时间未切换（可能仍在加载），请人工确认后重新开始')
    error.reasonCode = 'submit-uncertain'
    error.progressKnown = false
    throw error
  }

  async function runPhase({ phase, total, signal }) {
    emitState({ status: phase, phase, current: 0, total, score: null, error: null })

    // add some func
    const initial = await waitForStablePage(signal)

    // add some func
    if (phase === 'daily') {
      if (initial.kind === 'home') {
        // add some func
        if (initial.hasEnterButton === false) {
          throw new Error('home page detected but "评定今日歌曲" button not found')
        }
        emitState({ action: '进入每日歌曲' })
        const enterResult = await adapter.enterTodayTask()
        if (!enterResult || enterResult.ok !== true) {
          throw new Error('enterTodayTask failed: ' + ((enterResult && enterResult.reason) || 'unknown'))
        }
        let navigationAttempts = 0
        let postEnter = await inspectSafe()
        while ((postEnter.kind === 'loading' || (postEnter.kind === 'blocked' && postEnter.reason === 'unknown-page')) && navigationAttempts < 20) {
          navigationAttempts++
          await sleepFn(300, signal)
          postEnter = await inspectSafe()
        }
        if (postEnter.kind !== 'rating') {
          throw new Error('entry navigation did not reach rating page: ' + postEnter.kind + (postEnter.reason ? ' / ' + postEnter.reason : ''))
        }
      } else if (initial.kind === 'rating' && initial.song && initial.song.phase === 'daily') {
        emitState({ action: '已在每日歌曲评分页' })
      } else if (initial.kind === 'rating' && initial.song.phase === 'extra') {
        // add some func
        throw new Error('cannot start daily phase: already in extra phase')
      } else if (initial.kind === 'stage-complete' && initial.phase === 'extra') {
        throw new Error('cannot start daily phase: extra stage already complete')
      } else if (initial.kind === 'blocked') {
        let dailyDebugMsg = 'cannot start daily phase: ' + (initial.reason || 'blocked');
        if (initial.debug) {
          dailyDebugMsg += ' | data-page: ' + (initial.debug.dataPage || 'null');
        }
        if (initial.bodySnippet) {
          dailyDebugMsg += ' | page content: ' + initial.bodySnippet.substring(0, 200);
        }
        throw new Error(dailyDebugMsg);
      } else {
        throw new Error('cannot start daily phase: unexpected state ' + initial.kind);
      }
    } else {
      // add some func
      if (initial.kind === 'home') {
        throw new Error('cannot start extra phase from home')
      }
      if (initial.kind === 'stage-complete' && initial.phase === 'daily') {
        emitState({ action: '完成每日阶段，进入拓展' })
        const r = await adapter.completeStage()
        if (!r || r.ok !== true) {
          throw new Error('completeStage failed at daily boundary: ' + ((r && r.reason) || 'unknown'))
        }
        const enteredExtra = await waitForStablePage(signal)
        if (enteredExtra.kind !== 'rating' || !enteredExtra.song || enteredExtra.song.phase !== 'extra') {
          throw new Error('daily completion did not reach extra rating page: ' + enteredExtra.kind)
        }
      } else if (initial.kind === 'rating' && initial.song && initial.song.phase === 'extra') {
        // add some func
      } else if (initial.kind === 'blocked') {
        let extraDebugMsg = 'cannot start extra phase: ' + (initial.reason || 'blocked');
        if (initial.debug) {
          extraDebugMsg += ' | data-page: ' + (initial.debug.dataPage || 'null');
        }
        if (initial.bodySnippet) {
          extraDebugMsg += ' | page content: ' + initial.bodySnippet.substring(0, 200);
        }
        throw new Error(extraDebugMsg);
      } else {
        throw new Error('cannot start extra phase: unexpected state ' + initial.kind);
      }
    }

    let fallbackCurrent = 0
    const checkpoint = deps.checkpointStore && deps.checkpointStore.load()
    if (checkpoint && checkpoint.phase === phase) fallbackCurrent = checkpoint.confirmedCompleted
    let confirmedTransitions = 0
    while (confirmedTransitions < total) {
      // 切歌后页面可能再次短暂进入 loading，先等待稳定评分页再开始下一首。
      const re = await waitForStablePage(signal)
      if (re.kind !== 'rating') {
        throw new Error('expected rating page at ' + phase + ' song ' + (fallbackCurrent + 1) + ', got ' + re.kind + (re.reason ? ' / ' + re.reason : ''))
      }
      if (re.song && re.song.phase && re.song.phase !== phase) {
        throw new Error('phase mismatch: expected ' + phase + ', page says ' + re.song.phase)
      }
      const pageCurrent = re.progress && re.progress.known ? re.progress.current - 1 : null
      const current = Number.isInteger(pageCurrent) ? pageCurrent : fallbackCurrent
      const progressKnown = Number.isInteger(pageCurrent) || !!checkpoint
      emitState({ phase, current, total, progressKnown, score: null })
      const expectedSongId = re.songId

      // add some func
      emitState({ phase, current, total, action: '等待播放' })
      await waitForPlaybackGate(re, expectedSongId, signal)

      // add some func
      await rateAndSubmit(re.song, re.partNames, phase, current, signal)

      // add some func
      const trans = await confirmTransition(expectedSongId, signal)
      if (trans.kind === 'home') {
        if (phase !== 'extra') {
          throw new Error('home reached early at ' + phase + ' song ' + (current + 1))
        }
        if (deps.checkpointStore) deps.checkpointStore.clear()
        return trans
      }
      if (trans.kind === 'stage-complete') {
        if (Number.isInteger(pageCurrent) && pageCurrent !== total - 1) {
          throw new Error('stage-complete reached early at ' + phase + ' song ' + (current + 1))
        }
        if (deps.checkpointStore) {
          deps.checkpointStore.save({
            phase,
            confirmedCompleted: total,
            currentSongId: null,
            plannedScore: null,
            lastConfirmedBoundary: expectedSongId,
          })
        }
        // add some func
        return trans
      }
      if (trans.kind !== 'rating') {
        throw new Error('unexpected transition kind: ' + trans.kind)
      }
      fallbackCurrent = current + 1
      confirmedTransitions++
      if (deps.checkpointStore) {
        deps.checkpointStore.save({
          phase,
          confirmedCompleted: fallbackCurrent,
          currentSongId: trans.songId,
          plannedScore: null,
          lastConfirmedBoundary: expectedSongId,
        })
      }
      emitState({ phase, current: fallbackCurrent, total, progressKnown, score: null })
    }

    // add some func
    throw new Error('phase ended without stage-complete')
  }

  async function runToCompletion(signal) {
    emitState({ status: 'preparing', action: '准备启动评分' })

    const startingState = await waitForStablePage(signal)
    if (startingState.kind === 'home' && startingState.hasContinueButton === true) {
      emitState({ status: 'preparing', phase: 'extra', current: 0, total: EXTRA_TOTAL, action: '继续评分（从断点恢复）' })
      if (typeof adapter.continueRating !== 'function') {
        throw new Error('continueRating is unavailable')
      }
      const continueResult = await adapter.continueRating()
      if (!continueResult || continueResult.ok !== true) {
        throw new Error('continueRating failed: ' + ((continueResult && continueResult.reason) || 'unknown'))
      }
      const resumedPage = await waitForStablePage(signal)
      if (resumedPage.kind !== 'rating' || !resumedPage.song || resumedPage.song.phase !== 'extra') {
        throw new Error('continueRating did not reach extra rating page: ' + resumedPage.kind)
      }
    } else if (startingState.kind === 'rating' && startingState.song && startingState.song.phase === 'extra') {
      emitState({ status: 'preparing', phase: 'extra', current: 0, total: EXTRA_TOTAL, action: '已在拓展歌曲评分页' })
    } else {
      await runPhase({ phase: 'daily', total: DAILY_TOTAL, signal })

      emitState({ status: 'preparing', action: '每日阶段完成，准备进入拓展' })
      const afterDaily = await inspectSafe()
      if (afterDaily.kind !== 'stage-complete' || afterDaily.phase !== 'daily') {
        throw new Error('expected daily stage-complete, got ' + afterDaily.kind + (afterDaily.phase ? ' / ' + afterDaily.phase : ''))
      }
      emitState({ action: '完成每日阶段' })
      const dailyComplete = await adapter.completeStage()
      if (!dailyComplete || dailyComplete.ok !== true) {
        throw new Error('completeStage failed at daily: ' + ((dailyComplete && dailyComplete.reason) || 'unknown'))
      }
    }

    const extraBoundary = await runPhase({ phase: 'extra', total: EXTRA_TOTAL, signal })

    if (extraBoundary && extraBoundary.kind === 'home') {
      emitState({ status: 'completed', action: '评分全部完成', remainingMs: null })
      running = false
      return { success: true }
    }

    // add some func
    emitState({ status: 'preparing', action: '检查拓展阶段完成状态' })
    const afterExtra = await inspectSafe()
    if (afterExtra.kind !== 'stage-complete' || afterExtra.phase !== 'extra') {
      throw new Error('expected extra stage-complete, got ' + afterExtra.kind + (afterExtra.phase ? ' / ' + afterExtra.phase : ''))
    }
    emitState({ action: '完成拓展阶段' })
    const extraComplete = await adapter.completeStage()
    if (!extraComplete || extraComplete.ok !== true) {
      throw new Error('completeStage failed at extra: ' + ((extraComplete && extraComplete.reason) || 'unknown'))
    }

    // add some func
    let attempts = 0
    while (attempts < 20) {
      attempts++
      // add some func
      const re = await dismissOverlayIfNeeded()
      if (re.kind === 'home') {
        if (deps.checkpointStore) deps.checkpointStore.clear()
        emitState({ status: 'completed', action: '评分全部完成', remainingMs: null })
        running = false
        return { success: true }
      }
      if (re.kind === 'blocked') {
        throw new Error('home not reached: ' + (re.reason || 'blocked'))
      }
      try {
        await sleepFn(300, signal)
      } catch (e) {
        throw new Error('home-wait aborted')
      }
    }
    throw new Error('home not reached after extra stage-complete')
  }

  // add some func
  function start() {
    if (running) {
      return Promise.resolve({ success: false, code: 'already-running' })
    }
    running = true
    abortController = new AbortController()
    const signal = abortController.signal

    emitState({ status: 'preparing', action: '准备启动评分', error: null, score: null })

    return runToCompletion(signal).then(
      (result) => result,
      (err) => {
        const reason = (err && err.message) || String(err)
        // add some func
        if (signal.aborted && cancelReason) {
          return failPaused(cancelReason)
        }
        return failPaused(reason, err && err.reasonCode ? { reasonCode: err.reasonCode, progressKnown: err.progressKnown } : null)
      }
    )
  }

  // add some func
  function cancel(reason) {
    if (!abortController) return
    cancelReason = reason || 'cancelled'
    try {
      abortController.abort()
    } catch (_) {}
  }

  function getStatus() {
    return { ...runState }
  }

  return {
    start,
    cancel,
    getStatus,
    DEFAULT_TIMING,
  }
}

module.exports = {
  createMusicPartnerAutomation,
  DEFAULT_TIMING,
  DAILY_TOTAL,
  EXTRA_TOTAL,
}
