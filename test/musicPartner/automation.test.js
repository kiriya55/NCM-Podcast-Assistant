'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  createMusicPartnerAutomation,
  DEFAULT_TIMING,
} = require('../../electron/musicPartner/automation')
const { createRandomBalancedStrategy } = require('../../electron/musicPartner/scoreStrategy')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A deterministic sequence-based random source. */
function sequence(values) {
  let i = 0
  return () => {
    if (i >= values.length) throw new Error('random sequence exhausted at index ' + i)
    return values[i++]
  }
}

/** An infinite deterministic sequence that cycles through the given values. */
function cycle(values) {
  let i = 0
  return () => {
    const v = values[i % values.length]
    i++
    return v
  }
}

/** A controllable sleep that records delays and resolves immediately unless overridden. */
function createFakeSleep() {
  const calls = []
  const sleep = (ms, signal) => {
    calls.push({ ms, signal })
    return Promise.resolve()
  }
  return { sleep, calls }
}

/** A controllable clock. */
function createFakeClock(initial = 0) {
  let now = initial
  return {
    advance(ms) { now += ms },
    now() { return now },
  }
}

// ---------------------------------------------------------------------------
// Fake page adapter — drives a scripted page state machine.
// ---------------------------------------------------------------------------

/**
 * Build a fake adapter that simulates the Music Partner H5 page lifecycle.
 *
 * @param {object} opts
 * @param {number[]} opts.songIdsPerPhase - e.g. ['d1','d2','d3','d4','d5','e1',...,'e15']
 * @param {string[]} opts.partNames - parts available on every rating page
 * @param {object} opts.behavior - optional overrides: { failSubmitOnSongIndex }
 */
function createFakeAdapter({
  songIdsPerPhase,
  partNames = ['旋律', '演唱'],
  behavior = {},
}) {
  const dailyCount = songIdsPerPhase.slice(0, 5).length
  const extraCount = songIdsPerPhase.slice(5).length
  if (dailyCount !== 5 || extraCount !== 15) {
    throw new Error('fake adapter expects exactly 5 daily + 15 extra song ids')
  }
  const state = {
    page: 'home',
    phase: null,
    songIndex: -1,        // 0-based within phase
    songId: '',
    playback: { available: true, playing: true, currentTime: 0, duration: 180 },
    partNames,
    selectedScores: {},    // { overall: 0, 旋律: 0, ... }
    submitAttempts: 0,
    stageCompleteClicked: 0,
    enterClicked: 0,
  }
  const calls = []

  function setSelected(label, score) {
    state.selectedScores[label] = score
  }
  function selectedScore(label) {
    return state.selectedScores[label] || null
  }

  function gotoRating(phase, songIndex) {
    state.page = 'rating'
    state.phase = phase
    state.songIndex = songIndex
    state.songId = songIdsPerPhase[phase === 'daily' ? songIndex : 5 + songIndex]
    state.playback = { available: true, playing: true, currentTime: 0, duration: 180 }
    state.selectedScores = {}
  }

  function gotoStageComplete(phase) {
    state.page = 'stage-complete'
    state.phase = phase
  }

  function gotoHome() {
    state.page = 'home'
    state.phase = null
    state.songIndex = -1
    state.songId = ''
  }

  const adapter = {
    _state: state,
    _calls: calls,
    PAGE_CONTRACT: { overall: '总评', knownParts: partNames },

    async inspect() {
      calls.push({ type: 'inspect' })
      if (state.page === 'home') return { kind: 'home' }
      if (state.page === 'stage-complete') return { kind: 'stage-complete', phase: state.phase }
      if (state.page === 'rating') {
        return {
          kind: 'rating',
          songId: state.songId,
          song: { songId: state.songId, name: 'song-' + state.songId, author: 'a', phase: state.phase, songIndex: state.songIndex },
          partNames: state.partNames.slice(),
          playback: { ...state.playback },
          progress: { current: state.phase === 'daily' ? state.songIndex + 1 : null, total: state.phase === 'daily' ? 5 : 15, known: state.phase === 'daily' },
          selectedScores: { overall: state.selectedScores['总评'] || null, parts: Object.fromEntries(Object.entries(state.selectedScores).filter(([key]) => key !== '总评')) },
        }
      }
      return { kind: 'blocked', reason: 'unknown' }
    },

    async enterTodayTask() {
      calls.push({ type: 'enterTodayTask' })
      if (state.page !== 'home') return { ok: false, reason: 'not-home' }
      state.enterClicked++
      gotoRating('daily', 0)
      return { ok: true, label: '评定今日歌曲' }
    },

    async clickScore(label, score) {
      calls.push({ type: 'clickScore', label, score })
      if (state.page !== 'rating') return { ok: false, reason: 'not-rating' }
      if (behavior.failClickOnScore && behavior.failClickOnScore(label, score)) {
        return { ok: false, reason: 'select-not-confirmed' }
      }
      setSelected(label, score)
      return { ok: true, label, score, confirmedScore: score }
    },

    async submitCurrentSong() {
      calls.push({ type: 'submitCurrentSong' })
      if (state.page !== 'rating') return { ok: false, reason: 'not-rating' }
      state.submitAttempts++
      if (behavior.failSubmitOnSongIndex === state.songIndex) {
        return { ok: true, label: '提交并进入下首歌曲' }
      }
      const isDaily = state.phase === 'daily'
      const total = isDaily ? 5 : 15
      if (state.songIndex + 1 < total) {
        gotoRating(state.phase, state.songIndex + 1)
      } else if (!isDaily && behavior.extraFinalToHome) {
        gotoHome()
      } else {
        gotoStageComplete(state.phase)
      }
      return { ok: true, label: '提交并进入下首歌曲' }
    },

    async completeStage() {
      calls.push({ type: 'completeStage' })
      if (state.page !== 'stage-complete') return { ok: false, reason: 'not-stage-complete' }
      state.stageCompleteClicked++
      if (state.phase === 'daily') {
        gotoRating('extra', 0)
      } else {
        gotoHome()
      }
      return { ok: true, label: '完成评定' }
    },
  }

  return { adapter, state }
}

// ---------------------------------------------------------------------------
// Build automation with injected fakes
// ---------------------------------------------------------------------------

function buildAutomation({
  songIdsPerPhase,
  partNames,
  behavior,
  random,
  checkpointStore,
  strategy: strategyOverride,
}) {
  const { adapter, state } = createFakeAdapter({ songIdsPerPhase, partNames, behavior })
  const clock = createFakeClock(0)
  const sleepRec = createFakeSleep()
  const events = []
  const defaultRandom = cycle([0.5, 0.0, 0.5, 0.999])
  const strategy = strategyOverride || createRandomBalancedStrategy({ random: random || defaultRandom })
  const automation = createMusicPartnerAutomation({
    adapter,
    strategy,
    timing: DEFAULT_TIMING,
    now: clock.now,
    sleep: sleepRec.sleep,
    random: random || defaultRandom,
    emit: (event) => events.push(event),
    checkpointStore,
  })
  return { adapter, state, automation, events, clock, sleepRec }
}

const SONG_IDS = [
  'd1', 'd2', 'd3', 'd4', 'd5',
  'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12', 'e13', 'e14', 'e15',
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('happy path: 5 daily + 15 extra + 2 stage-completes ends at completed', async () => {
  const { automation, events, adapter } = buildAutomation({
    songIdsPerPhase: SONG_IDS,
    partNames: ['旋律', '演唱'],
    // Make playback appear to be playing and currentTime reach 15s after first poll.
    // We don't have direct control of playback in fake adapter; the adapter reports
    // playing=true, currentTime=0. The automation polls until observed playback
    // >= requiredPlaybackMs. Fake sleep resolves immediately, so playback must
    // advance via a behavior hook. We use the playback behavior below.
  })

  // The fake adapter's playback stays at currentTime=0 forever. To let the
  // automation observe 15s of playback, we make the fake adapter's playback
  // advance with each inspect call.
  let inspectCount = 0
  const origInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    inspectCount++
    const state = adapter._state
    // Each inspect advances playback by 1s (simulating time progressing per poll).
    if (state.page === 'rating' && state.playback.playing) {
      state.playback.currentTime = Math.min(state.playback.duration, state.playback.currentTime + 5)
    }
    return origInspect()
  }

  await automation.start()

  // The flow must end in completed.
  const last = events[events.length - 1]
  assert.equal(last.status, 'completed')

  // Two stage-complete clicks happened (one for daily, one for extra).
  assert.equal(adapter._state.stageCompleteClicked, 2)

  // 20 submitCurrentSong clicks happened (5 + 15).
  const submitCount = adapter._calls.filter(c => c.type === 'submitCurrentSong').length
  assert.equal(submitCount, 20)

  // 20 overall + 20*2 parts = 60 clickScore calls.
  const scoreCount = adapter._calls.filter(c => c.type === 'clickScore').length
  assert.equal(scoreCount, 20 * 3)

  // One enterTodayTask call.
  assert.equal(adapter._calls.filter(c => c.type === 'enterTodayTask').length, 1)

  // Events include phase progress: daily N/5 and extra N/15.
  const dailyEvents = events.filter(e => e.phase === 'daily' && typeof e.current === 'number' && e.total === 5)
  const extraEvents = events.filter(e => e.phase === 'extra' && typeof e.current === 'number' && e.total === 15)
  assert.ok(dailyEvents.length >= 5, 'daily progress events emitted')
  assert.ok(extraEvents.length >= 15, 'extra progress events emitted')
})

test('extra final submit completes when the page returns directly home', async () => {
  const { automation, events, adapter } = buildAutomation({
    songIdsPerPhase: SONG_IDS,
    behavior: { extraFinalToHome: true },
  })
  const originalInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    if (adapter._state.page === 'rating' && adapter._state.playback.playing) {
      adapter._state.playback.currentTime = Math.min(adapter._state.playback.duration, adapter._state.playback.currentTime + 20)
    }
    return originalInspect()
  }

  const result = await automation.start()

  assert.deepEqual(result, { success: true })
  assert.equal(events[events.length - 1].status, 'completed')
  assert.equal(adapter._state.stageCompleteClicked, 1, 'only the daily completion dialog is clicked')
  assert.equal(adapter._calls.filter(call => call.type === 'submitCurrentSong').length, 20)
})

test('manual intervention pauses without trying to dismiss it', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  let dismissCalls = 0
  adapter.inspect = async () => ({
    kind: 'intervention',
    interventionType: 'choice-required',
    canAutoDismiss: false,
  })
  adapter.dismissOverlay = async () => {
    dismissCalls += 1
    return { ok: true }
  }

  await automation.start()

  const last = events[events.length - 1]
  assert.equal(last.status, 'paused')
  assert.match(last.error, /choice-required/)
  assert.equal(dismissCalls, 0)
})

test('safe overlay is dismissed before the page is inspected again', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  const originalInspect = adapter.inspect.bind(adapter)
  let overlayVisible = true
  let dismissCalls = 0
  adapter.inspect = async function () {
    if (overlayVisible) return { kind: 'overlay', overlayType: 'dismissible', canAutoDismiss: true }
    if (adapter._state.page === 'rating' && adapter._state.playback.playing) {
      adapter._state.playback.currentTime = Math.min(adapter._state.playback.duration, adapter._state.playback.currentTime + 20)
    }
    return originalInspect()
  }
  adapter.dismissOverlay = async () => {
    dismissCalls += 1
    overlayVisible = false
    return { ok: true, label: '我知道了' }
  }

  await automation.start()

  assert.equal(events[events.length - 1].status, 'completed')
  assert.equal(dismissCalls, 1)
})

test('happy path: events use correct statuses for each phase', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  const origInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    const state = adapter._state
    if (state.page === 'rating' && state.playback.playing) {
      state.playback.currentTime = Math.min(state.playback.duration, state.playback.currentTime + 5)
    }
    return origInspect()
  }
  await automation.start()
  const statuses = events.map(e => e.status)
  assert.ok(statuses.includes('preparing'))
  assert.ok(statuses.includes('daily'))
  assert.ok(statuses.includes('extra'))
  assert.ok(statuses[statuses.length - 1] === 'completed')
})

test('handles single-part song (only 旋律 visible)', async () => {
  const { automation, adapter, events } = buildAutomation({
    songIdsPerPhase: SONG_IDS,
    partNames: ['旋律'],
  })
  const origInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    const state = adapter._state
    if (state.page === 'rating' && state.playback.playing) {
      state.playback.currentTime = Math.min(state.playback.duration, state.playback.currentTime + 5)
    }
    return origInspect()
  }
  await automation.start()
  // Each song should have 1 overall + 1 旋律 = 2 clickScore calls.
  const scoreCount = adapter._calls.filter(c => c.type === 'clickScore').length
  assert.equal(scoreCount, 20 * 2)
  assert.equal(events[events.length - 1].status, 'completed')
})

test('handles three-part song (旋律/演唱/歌词)', async () => {
  const { automation, adapter } = buildAutomation({
    songIdsPerPhase: SONG_IDS,
    partNames: ['旋律', '演唱', '歌词'],
  })
  const origInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    const state = adapter._state
    if (state.page === 'rating' && state.playback.playing) {
      state.playback.currentTime = Math.min(state.playback.duration, state.playback.currentTime + 5)
    }
    return origInspect()
  }
  await automation.start()
  const scoreCount = adapter._calls.filter(c => c.type === 'clickScore').length
  assert.equal(scoreCount, 20 * 4)
})

test('scores parts that appear only after the overall score is clicked', async () => {
  const { automation, adapter, events } = buildAutomation({ songIdsPerPhase: SONG_IDS, partNames: [] })
  const originalInspect = adapter.inspect.bind(adapter)
  const originalClickScore = adapter.clickScore.bind(adapter)
  adapter.inspect = async function () {
    if (adapter._state.page === 'rating' && adapter._state.playback.playing) {
      adapter._state.playback.currentTime = Math.min(adapter._state.playback.duration, adapter._state.playback.currentTime + 20)
    }
    return originalInspect()
  }
  adapter.clickScore = async function (label, score) {
    const result = await originalClickScore(label, score)
    if (label === '总评') adapter._state.partNames = ['旋律', '演唱', '歌词']
    return result
  }

  await automation.start()

  assert.equal(events[events.length - 1].status, 'completed')
  const partClicks = adapter._calls.filter(call => call.type === 'clickScore' && call.label !== '总评')
  assert.equal(partClicks.length, 60)
})

test('resumes at extra tasks when the home page says daily tasks are already complete', async () => {
  const { automation, adapter, events } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  const originalInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    if (adapter._state.page === 'home' && adapter._state.enterClicked === 0) {
      return { kind: 'home', hasEnterButton: false, hasContinueButton: true }
    }
    if (adapter._state.page === 'rating' && adapter._state.playback.playing) {
      adapter._state.playback.currentTime = Math.min(adapter._state.playback.duration, adapter._state.playback.currentTime + 20)
    }
    return originalInspect()
  }
  adapter.continueRating = async function () {
    adapter._state.page = 'rating'
    adapter._state.phase = 'extra'
    adapter._state.songIndex = 0
    adapter._state.songId = SONG_IDS[5]
    adapter._state.playback = { available: true, playing: true, currentTime: 0, duration: 180 }
    return { ok: true }
  }

  await automation.start()

  assert.equal(events[events.length - 1].status, 'completed')
  assert.equal(adapter._calls.filter(call => call.type === 'enterTodayTask').length, 0)
  assert.equal(adapter._calls.filter(call => call.type === 'submitCurrentSong').length, 15)
})

test('resumes directly from an interrupted extra rating page', async () => {
  const { automation, adapter, events } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  adapter._state.page = 'rating'
  adapter._state.phase = 'extra'
  adapter._state.songIndex = 0
  adapter._state.songId = SONG_IDS[5]
  const originalInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    if (adapter._state.page === 'rating') adapter._state.playback.currentTime += 20
    return originalInspect()
  }

  const result = await automation.start()

  assert.deepEqual(result, { success: true })
  assert.equal(events[events.length - 1].status, 'completed')
  assert.equal(adapter._calls.filter(call => call.type === 'enterTodayTask').length, 0)
  assert.equal(adapter._calls.filter(call => call.type === 'submitCurrentSong').length, 15)
})

test('waits through a transient unknown shell after continuing extra tasks from home', async () => {
  const { automation, adapter, events } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  const originalInspect = adapter.inspect.bind(adapter)
  let initialHome = true
  let shellInspections = 0

  adapter.inspect = async function () {
    if (initialHome) return { kind: 'home', hasEnterButton: false, hasContinueButton: true }
    if (shellInspections > 0) {
      shellInspections--
      return { kind: 'blocked', reason: 'unknown-page' }
    }
    if (adapter._state.page === 'rating') adapter._state.playback.currentTime += 20
    return originalInspect()
  }
  adapter.continueRating = async function () {
    initialHome = false
    adapter._state.page = 'rating'
    adapter._state.phase = 'extra'
    adapter._state.songIndex = 0
    adapter._state.songId = SONG_IDS[5]
    shellInspections = 2
    return { ok: true }
  }

  const result = await automation.start()

  assert.deepEqual(result, { success: true })
  assert.equal(events[events.length - 1].status, 'completed')
})

test('resumes from the current daily rating page after entry was interrupted', async () => {
  const { automation, adapter, events } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  await adapter.enterTodayTask()
  const originalInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    if (adapter._state.page === 'rating' && adapter._state.playback.playing) {
      adapter._state.playback.currentTime = Math.min(adapter._state.playback.duration, adapter._state.playback.currentTime + 20)
    }
    return originalInspect()
  }

  await automation.start()

  assert.equal(events[events.length - 1].status, 'completed')
  assert.equal(adapter._calls.filter(call => call.type === 'enterTodayTask').length, 1)
})

test('resumes from daily song 4 using page progress and does not report an early completion', async () => {
  const { automation, adapter, events } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  await adapter.enterTodayTask()
  adapter._state.songIndex = 3
  adapter._state.songId = 'd4'
  const originalInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    if (adapter._state.page === 'rating') adapter._state.playback.currentTime += 20
    return originalInspect()
  }

  const result = await automation.start()

  assert.deepEqual(result, { success: true })
  assert.equal(events[events.length - 1].status, 'completed')
  assert.equal(adapter._calls.filter(call => call.type === 'submitCurrentSong').length, 17)
})

test('same-song timeout pauses as submit-uncertain and never retries submit', async () => {
  const { automation, adapter, events } = buildAutomation({
    songIdsPerPhase: SONG_IDS,
    behavior: { failSubmitOnSongIndex: 0 },
  })
  const originalInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    if (adapter._state.page === 'rating') adapter._state.playback.currentTime += 20
    return originalInspect()
  }

  const result = await automation.start()

  assert.equal(result.code, 'paused')
  assert.equal(events[events.length - 1].reasonCode, 'submit-uncertain')
  assert.equal(events[events.length - 1].progressKnown, false)
  assert.equal(adapter._calls.filter(call => call.type === 'submitCurrentSong').length, 1)
})

test('reuses a persisted planned score for the same song', async () => {
  const saved = []
  const checkpointStore = {
    load: () => ({
      phase: 'daily', confirmedCompleted: 0, currentSongId: 'd1',
      plannedScore: { overall: 4, parts: { '旋律': 3, '演唱': 5 } },
    }),
    save: value => { saved.push(value); return value },
    clear() {},
  }
  let strategyCalls = 0
  const { automation, adapter } = buildAutomation({
    songIdsPerPhase: SONG_IDS,
    checkpointStore,
    strategy: { score() { strategyCalls++; return { overall: 3, parts: { '旋律': 3, '演唱': 3 } } } },
  })
  const originalInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    if (adapter._state.page === 'rating') adapter._state.playback.currentTime += 20
    return originalInspect()
  }

  await automation.start()

  const firstClicks = adapter._calls.filter(call => call.type === 'clickScore').slice(0, 3)
  assert.deepEqual(firstClicks.map(call => call.score), [4, 3, 5])
  assert.equal(strategyCalls, 19)
  assert.ok(saved.length > 0)
})

test('pauses when inspect returns blocked', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  // Override inspect to return blocked.
  adapter.inspect = async () => ({ kind: 'blocked', reason: 'unknown-page' })
  await automation.start()
  const last = events[events.length - 1]
  assert.equal(last.status, 'paused')
  assert.ok(last.error && last.error.indexOf('unknown-page') !== -1, 'error mentions reason')
})

test('pauses when enterTodayTask fails', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  adapter.enterTodayTask = async () => ({ ok: false, reason: 'target-missing' })
  await automation.start()
  const last = events[events.length - 1]
  assert.equal(last.status, 'paused')
  assert.ok(last.error.indexOf('target-missing') !== -1)
})

test('waits for the first rating page while entry navigation is loading', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  const originalEnter = adapter.enterTodayTask.bind(adapter)
  const originalInspect = adapter.inspect.bind(adapter)
  let loadingInspections = 0
  adapter.enterTodayTask = async () => {
    const result = await originalEnter()
    loadingInspections = 2
    return result
  }
  adapter.inspect = async () => {
    if (loadingInspections > 0) {
      loadingInspections--
      return { kind: 'loading' }
    }
    if (adapter._state.page === 'rating') {
      adapter._state.playback.currentTime = Math.min(adapter._state.playback.duration, adapter._state.playback.currentTime + 20)
    }
    return originalInspect()
  }

  await automation.start()

  assert.equal(events[events.length - 1].status, 'completed')
})

test('waits through a transient unknown shell after entering the daily task', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  const originalEnter = adapter.enterTodayTask.bind(adapter)
  const originalInspect = adapter.inspect.bind(adapter)
  let shellInspections = 0
  adapter.enterTodayTask = async () => {
    const result = await originalEnter()
    shellInspections = 2
    return result
  }
  adapter.inspect = async () => {
    if (shellInspections > 0) {
      shellInspections -= 1
      return { kind: 'blocked', reason: 'unknown-page' }
    }
    if (adapter._state.page === 'rating') {
      adapter._state.playback.currentTime = Math.min(adapter._state.playback.duration, adapter._state.playback.currentTime + 20)
    }
    return originalInspect()
  }

  await automation.start()

  assert.equal(events[events.length - 1].status, 'completed')
})

test('waits through the initial empty H5 shell before deciding the start page', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  const originalInspect = adapter.inspect.bind(adapter)
  let shells = 2
  adapter.inspect = async () => {
    if (shells-- > 0) return { kind: 'blocked', reason: 'unknown-page' }
    if (adapter._state.page === 'rating') adapter._state.playback.currentTime += 20
    return originalInspect()
  }

  const result = await automation.start()

  assert.deepEqual(result, { success: true })
  assert.equal(events[events.length - 1].status, 'completed')
})

test('waits for a second loading state after transition before starting the next extra song', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  const originalInspect = adapter.inspect.bind(adapter)
  let transitionQueue = []

  adapter.submitCurrentSong = async () => {
    const result = await createFakeAdapterSubmit(adapter)
    if (adapter._state.phase === 'extra' && adapter._state.songIndex < 14) {
      transitionQueue = ['rating', 'loading']
    }
    return result
  }

  adapter.inspect = async () => {
    const next = transitionQueue.shift()
    if (next === 'loading') return { kind: 'loading' }
    if (next === 'rating') return originalInspect()
    if (adapter._state.page === 'rating') {
      adapter._state.playback.currentTime = Math.min(
        adapter._state.playback.duration,
        adapter._state.playback.currentTime + 20,
      )
    }
    return originalInspect()
  }

  const result = await automation.start()

  assert.deepEqual(result, { success: true })
  assert.equal(events[events.length - 1].status, 'completed')

  async function createFakeAdapterSubmit(currentAdapter) {
    const state = currentAdapter._state
    const isDaily = state.phase === 'daily'
    const total = isDaily ? 5 : 15
    const nextIndex = state.songIndex + 1
    if (nextIndex < total) {
      state.page = 'rating'
      state.songIndex = nextIndex
      state.songId = SONG_IDS[isDaily ? nextIndex : 5 + nextIndex]
      state.playback = { available: true, playing: true, currentTime: 0, duration: 180 }
      state.selectedScores = {}
    } else if (!isDaily) {
      state.page = 'stage-complete'
    } else {
      state.page = 'stage-complete'
    }
    return { ok: true, label: '鎻愪氦骞惰繘鍏ヤ笅棣栨瓕鏇?' }
  }
})

test('pauses when playback stays below 15 seconds', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  // Playback never advances past 5s.
  const origInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    const state = adapter._state
    if (state.page === 'rating' && state.playback.playing) {
      state.playback.currentTime = 5
    }
    return origInspect()
  }
  await automation.start()
  const last = events[events.length - 1]
  assert.equal(last.status, 'paused')
  assert.ok(last.error && /playback/i.test(last.error), 'error mentions playback')
})

test('pauses when playback stops mid-wait', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  let poll = 0
  const origInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    const state = adapter._state
    if (state.page === 'rating') {
      poll++
      if (poll <= 2) {
        state.playback.playing = true
        state.playback.currentTime = poll * 5
      } else {
        // Playback stopped before reaching 15s.
        state.playback.playing = false
      }
    }
    return origInspect()
  }
  await automation.start()
  const last = events[events.length - 1]
  assert.equal(last.status, 'paused')
  assert.ok(/playback/i.test(last.error))
})

test('pauses when songId changes during the playback wait', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  let poll = 0
  const origInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    const state = adapter._state
    if (state.page === 'rating') {
      poll++
      state.playback.playing = true
      state.playback.currentTime = poll * 5
      if (poll === 3) {
        // Page changed song under us.
        state.songId = 'unexpected'
      }
    }
    return origInspect()
  }
  await automation.start()
  const last = events[events.length - 1]
  assert.equal(last.status, 'paused')
  assert.ok(/song/i.test(last.error))
})

test('pauses when overall click fails', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  const origInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    const state = adapter._state
    if (state.page === 'rating' && state.playback.playing) {
      state.playback.currentTime = Math.min(state.playback.duration, state.playback.currentTime + 20)
    }
    return origInspect()
  }
  adapter.clickScore = async (label, score) => {
    if (label === '总评') return { ok: false, reason: 'select-not-confirmed' }
    return { ok: true, label, score, confirmedScore: score }
  }
  await automation.start()
  const last = events[events.length - 1]
  assert.equal(last.status, 'paused')
  assert.ok(/总评/.test(last.error) || /select-not-confirmed/.test(last.error))
})

test('pauses when a part click fails', async () => {
  const { automation, events, adapter } = buildAutomation({
    songIdsPerPhase: SONG_IDS,
    partNames: ['旋律', '演唱'],
  })
  const origInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    const state = adapter._state
    if (state.page === 'rating' && state.playback.playing) {
      state.playback.currentTime = Math.min(state.playback.duration, state.playback.currentTime + 20)
    }
    return origInspect()
  }
  adapter.clickScore = async (label, score) => {
    if (label === '演唱') return { ok: false, reason: 'select-not-confirmed' }
    return { ok: true, label, score, confirmedScore: score }
  }
  await automation.start()
  const last = events[events.length - 1]
  assert.equal(last.status, 'paused')
})

test('pauses when submit does not advance to next song or stage-complete', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  const origInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    const state = adapter._state
    if (state.page === 'rating' && state.playback.playing) {
      state.playback.currentTime = Math.min(state.playback.duration, state.playback.currentTime + 20)
    }
    return origInspect()
  }
  // Override submitCurrentSong to be "successful" but NOT change state.
  adapter.submitCurrentSong = async () => ({ ok: true, label: '提交并进入下首歌曲' })
  await automation.start()
  const last = events[events.length - 1]
  assert.equal(last.status, 'paused')
  assert.ok(/transition|next|advance/i.test(last.error))
})

test('pauses when completeStage fails at end of daily phase', async () => {
  const { automation, events, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  const origInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    const state = adapter._state
    if (state.page === 'rating' && state.playback.playing) {
      state.playback.currentTime = Math.min(state.playback.duration, state.playback.currentTime + 20)
    }
    return origInspect()
  }
  let firstCall = true
  adapter.completeStage = async () => {
    if (firstCall) {
      firstCall = false
      return { ok: false, reason: 'target-missing' }
    }
    return { ok: true, label: '完成评定' }
  }
  await automation.start()
  const last = events[events.length - 1]
  assert.equal(last.status, 'paused')
  assert.ok(/complete|target-missing|完成/.test(last.error))
})

test('waits for the first extra rating page when daily completion navigation is delayed', async () => {
  const { automation, adapter, events } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  const originalInspect = adapter.inspect.bind(adapter)
  const originalCompleteStage = adapter.completeStage.bind(adapter)
  let dailyCompleteCalls = 0
  let loadingInspections = 0

  adapter.completeStage = async function () {
    if (adapter._state.phase === 'daily') {
      dailyCompleteCalls++
      if (dailyCompleteCalls === 1) return { ok: true, label: '完成评定' }
      const result = await originalCompleteStage()
      loadingInspections = 1
      return result
    }
    return originalCompleteStage()
  }
  adapter.inspect = async function () {
    if (loadingInspections > 0) {
      loadingInspections--
      return { kind: 'loading' }
    }
    if (adapter._state.page === 'rating') adapter._state.playback.currentTime += 20
    return originalInspect()
  }

  const result = await automation.start()

  assert.deepEqual(result, { success: true })
  assert.equal(events[events.length - 1].status, 'completed')
  assert.equal(dailyCompleteCalls, 2)
})

test('cancel(reason) stops the run and emits paused with the reason', async () => {
  // Use a barrier sleep that only resolves on abort, so cancel actually
  // interrupts an in-progress wait instead of racing a no-op fake sleep.
  const barrierSleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(new Error('aborted')); return }
    if (signal) signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    // Never resolves on its own.
  })
  const { createMusicPartnerAutomation: build } = require('../../electron/musicPartner/automation')
  const { createRandomBalancedStrategy } = require('../../electron/musicPartner/scoreStrategy')
  const { adapter } = createFakeAdapter({ songIdsPerPhase: SONG_IDS })
  const events = []
  // The adapter's playback will need to be in 'rating' to enter the gate.
  // We start at home; automation will call enterTodayTask, then inspect again
  // to find rating page, then enter the playback gate which will hit the barrier sleep.
  const automation = build({
    adapter,
    strategy: createRandomBalancedStrategy({ random: cycle([0.5, 0.0, 0.5, 0.999]) }),
    timing: DEFAULT_TIMING,
    sleep: barrierSleep,
    random: cycle([0.5]),
    emit: (e) => events.push(e),
  })
  // Trigger cancel after the first sleep call (microtask after start awaits the barrier).
  queueMicrotask(() => automation.cancel('手机窗口已关闭'))
  await automation.start()
  const last = events[events.length - 1]
  assert.equal(last.status, 'paused')
  assert.ok(/手机窗口已关闭/.test(last.error), 'error includes cancel reason; got: ' + last.error)
})

test('duplicate start returns { success: false, code: already-running } without launching a second flow', async () => {
  const { automation, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  const origInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    const state = adapter._state
    if (state.page === 'rating' && state.playback.playing) {
      state.playback.currentTime = Math.min(state.playback.duration, state.playback.currentTime + 20)
    }
    return origInspect()
  }
  // Block the first start on a barrier we release later.
  let resolveFirst
  const firstPromise = automation.start()
  // Immediately try a second start while the first is still running.
  const second = await automation.start()
  assert.equal(second.success, false)
  assert.equal(second.code, 'already-running')
  // Let the first finish.
  resolveFirst && resolveFirst()
  await firstPromise
})

test('cancel without an active run is a no-op', async () => {
  const { automation } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  automation.cancel('test')
  const status = automation.getStatus()
  assert.equal(status.status, 'idle')
})

test('getStatus reports the current phase/progress during a run', async () => {
  const { automation, adapter } = buildAutomation({ songIdsPerPhase: SONG_IDS })
  // Track per-song playback progression so each inspect advances currentTime.
  const origInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    const state = adapter._state
    if (state.page === 'rating' && state.playback.playing) {
      // Advance by 5s each inspect, capped at duration. Reset per song via the
      // fake adapter's gotoRating which sets currentTime=0.
      state.playback.currentTime = Math.min(state.playback.duration, state.playback.currentTime + 5)
    }
    return origInspect()
  }
  await automation.start()
  assert.equal(automation.getStatus().status, 'completed')
})

test('DEFAULT_TIMING exposes the required constants', () => {
  assert.equal(DEFAULT_TIMING.requiredPlaybackMs, 15_000)
  assert.deepEqual([...DEFAULT_TIMING.afterPlaybackMs], [2_000, 6_000])
  assert.deepEqual([...DEFAULT_TIMING.betweenScoresMs], [400, 1_200])
  assert.deepEqual([...DEFAULT_TIMING.beforeSubmitMs], [1_000, 3_000])
  assert.ok(Object.isFrozen(DEFAULT_TIMING))
})

test('score event includes overall and parts for each song', async () => {
  const { automation, events, adapter } = buildAutomation({
    songIdsPerPhase: SONG_IDS,
    partNames: ['旋律', '演唱'],
    // Strategy will produce overall 4 and parts 3/4/4/5 in sequence
    random: sequence([0.5, 0.0, 0.5, 0.999, 0.5, 0.0, 0.5, 0.999, 0.5, 0.0, 0.5, 0.999]),
  })
  const origInspect = adapter.inspect.bind(adapter)
  adapter.inspect = async function () {
    const state = adapter._state
    if (state.page === 'rating' && state.playback.playing) {
      state.playback.currentTime = Math.min(state.playback.duration, state.playback.currentTime + 20)
    }
    return origInspect()
  }
  await automation.start()
  const ratingEvents = events.filter(e => e.status === 'daily' || e.status === 'extra')
  // At least one event per song must carry the score.
  const scored = ratingEvents.filter(e => e.score && typeof e.score.overall === 'number')
  assert.ok(scored.length >= 20, 'every song has a score event')
  for (const e of scored) {
    assert.ok(e.score.overall >= 3 && e.score.overall <= 5)
    assert.ok(e.score.parts)
    for (const name of ['旋律', '演唱']) {
      assert.ok(typeof e.score.parts[name] === 'number')
      assert.ok(e.score.parts[name] >= 3 && e.score.parts[name] <= 5)
      assert.ok(Math.abs(e.score.parts[name] - e.score.overall) <= 1)
    }
  }
})
