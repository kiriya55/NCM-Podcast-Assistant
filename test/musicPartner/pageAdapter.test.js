'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')

const { createPageAdapter, PAGE_CONTRACT, PAGE_ADAPTER_HELPERS } = require('../../electron/musicPartner/pageAdapter')

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'music-partner')

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8')
}

/**
 * Build a fake webContents backed by a jsdom Document.
 * executeJavaScript runs the script in the jsdom window via vm,
 * but we cheat: we wrap the script in a function and run it inside
 * the jsdom window using `window.eval`. The script returned by the
 * adapter is always `(function () { ...helpers...; return action(...); })()`
 * which is a single expression. We eval it inside the jsdom window.
 */
function createFakeWebContents({ html, url }) {
  const dom = new JSDOM(html, {
    url: url || 'https://mp.music.163.com/home/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  })
  // Set the audio element's properties (jsdom's HTMLAudioElement is largely a stub).
  const audio = dom.window.document.querySelector('audio')
  if (audio) {
    Object.defineProperty(audio, 'paused', { value: true, configurable: true, writable: true })
    Object.defineProperty(audio, 'ended', { value: false, configurable: true, writable: true })
    Object.defineProperty(audio, 'currentTime', { value: 0, configurable: true, writable: true })
    Object.defineProperty(audio, 'duration', { value: 0, configurable: true, writable: true })
  }
  return {
    dom,
    audio,
    executeJavaScript(script) {
      // Run the script inside the jsdom window so `document` and `window` match.
      return Promise.resolve(dom.window.eval(script))
    },
  }
}

function makeAdapter({ html, url }) {
  const wc = createFakeWebContents({ html, url })
  let currentUrl = url || 'https://mp.music.163.com/home/index.html'
  const adapter = createPageAdapter({
    getWebContents: () => ({ executeJavaScript: wc.executeJavaScript.bind(wc) }),
    getUrl: () => currentUrl,
  })
  return {
    adapter,
    wc,
    setUrl(u) { currentUrl = u },
    getAudio() { return wc.audio },
  }
}

function liveRatingHtml({ selectedOverall = 0, includeParts = false } = {}) {
  const stars = Array.from({ length: 5 }, (_, index) => `<li class="${index < selectedOverall ? 'selected' : 'empty'}"></li>`).join('')
  const parts = includeParts ? `
    <div class="part"><div class="part-label">旋律</div><ul>${'<li class="empty"></li>'.repeat(5)}</ul></div>
    <div class="part"><div class="part-label">演唱</div><ul>${'<li class="empty"></li>'.repeat(5)}</ul></div>
    <div class="part"><div class="part-label">歌词</div><ul>${'<li class="empty"></li>'.repeat(5)}</ul></div>` : ''
  return `<!doctype html><html><body>
    <div data-log='{"oid":"page_web_music_partner_miniprogram_assess","params":{"s_cid":2745008455}}'>
      <h4>Live Song</h4><p class="author">Live Artist</p><audio></audio>
      <div class="rating"><p>${selectedOverall ? `${selectedOverall}星：有潜力` : '请评定'}</p><ul>${stars}</ul></div>
      ${parts}
      <div data-log='{"oid":"btn_web_music_partner_miniprogram_assess_next"}'>提交并评下一首</div>
      <span>1 / 5</span>
    </div>
  </body></html>`
}

// ---------------------------------------------------------------------------

test('inspect: home page returns { kind: "home" }', async () => {
  const { adapter } = makeAdapter({ html: readFixture('home.html') })
  const state = await adapter.inspect()
  assert.equal(state.kind, 'home')
})

test('inspect: rating exposes authoritative page progress and selected scores', async () => {
  const html = readFixture('rating.html')
    .replace('data-song-index="0"', 'data-song-index="3"')
    .replace('1 / 5', '4 / 5')
    .replace('data-value="">未选择', 'data-value="4">4 分')
    .replace('data-value="">未选择', 'data-value="3">3 分')
  const { adapter } = makeAdapter({ html })

  const state = await adapter.inspect()

  assert.deepEqual(state.progress, { current: 4, total: 5, known: true })
  assert.deepEqual(state.selectedScores, { overall: 4, parts: { '旋律': 3 } })
})

test('inspect: live extra rating marks progress unknown when no counter is visible', async () => {
  const { adapter } = makeAdapter({ html: liveRatingHtml().replace('<span>1 / 5</span>', '') })

  const state = await adapter.inspect()

  assert.deepEqual(state.progress, { current: null, total: 15, known: false })
})

test('inspect: live home marks the interrupted run as ready for extra tasks', async () => {
  const html = '<!doctype html><html><body><div class="page"><div class="continue">继续评定</div></div></body></html>'
  const { adapter } = makeAdapter({ html })

  const state = await adapter.inspect()

  assert.equal(state.kind, 'home')
  assert.equal(state.hasContinueButton, true)
})

test('continueRating: clicks the live home continue control', async () => {
  const html = '<!doctype html><html><body><div class="page"><div class="continue">继续评定</div></div></body></html>'
  const { adapter, wc } = makeAdapter({ html })
  let clicks = 0
  wc.dom.window.document.querySelector('.continue').addEventListener('click', () => { clicks += 1 })

  const result = await adapter.continueRating()

  assert.equal(result.ok, true)
  assert.equal(clicks, 1)
})

test('inspect: rating page returns song info, parts, playback', async () => {
  const { adapter } = makeAdapter({ html: readFixture('rating.html') })
  const state = await adapter.inspect()
  assert.equal(state.kind, 'rating')
  assert.equal(state.songId, 'song-001')
  assert.equal(state.song.name, '示例歌曲 A')
  assert.equal(state.song.author, '示例歌手')
  assert.deepEqual(state.partNames, ['旋律', '演唱'])
  assert.equal(state.playback.available, true)
  assert.equal(state.playback.playing, false)
})

test('inspect: live mission page returns its song and daily phase', async () => {
  const { adapter, getAudio } = makeAdapter({
    html: liveRatingHtml(),
    url: 'https://mp.music.163.com/mission/index.html',
  })
  getAudio().paused = false
  getAudio().currentTime = 16
  getAudio().duration = 180

  const state = await adapter.inspect()

  assert.equal(state.kind, 'rating', JSON.stringify(state))
  assert.equal(state.songId, '2745008455')
  assert.equal(state.song.name, 'Live Song')
  assert.equal(state.song.author, 'Live Artist')
  assert.equal(state.song.phase, 'daily')
  assert.deepEqual(state.partNames, [])
  assert.equal(state.playback.playing, true)
})

test('inspect: live mission page without a daily counter is an extra task', async () => {
  const html = liveRatingHtml().replace('<span>1 / 5</span>', '')
  const { adapter } = makeAdapter({ html, url: 'https://mp.music.163.com/mission/index.html' })

  const state = await adapter.inspect()

  assert.equal(state.kind, 'rating')
  assert.equal(state.song.phase, 'extra')
  assert.equal(state.song.songIndex, null)
})

test('inspect: live mission page reads parts revealed after overall selection', async () => {
  const { adapter } = makeAdapter({
    html: liveRatingHtml({ selectedOverall: 4, includeParts: true }),
    url: 'https://mp.music.163.com/mission/index.html',
  })

  const state = await adapter.inspect()

  assert.deepEqual(state.partNames, ['旋律', '演唱', '歌词'])
})

test('clickScore: live mission overall confirms the changed star count', async () => {
  const { adapter, wc } = makeAdapter({
    html: liveRatingHtml(),
    url: 'https://mp.music.163.com/mission/index.html',
  })
  const row = wc.dom.window.document.querySelector('.rating')
  row.querySelectorAll('li').forEach((star, index, stars) => {
    star.addEventListener('click', () => {
      stars.forEach((item, itemIndex) => { item.className = itemIndex <= index ? 'selected' : 'empty' })
      row.querySelector('p').textContent = `${index + 1}星：有潜力`
    })
  })

  const result = await adapter.clickScore('总评', 4)

  assert.equal(result.ok, true)
  assert.equal(result.confirmedScore, 4)
})

test('submitCurrentSong: live mission clicks the assess-next control', async () => {
  const { adapter, wc } = makeAdapter({
    html: liveRatingHtml({ selectedOverall: 4, includeParts: true }),
    url: 'https://mp.music.163.com/mission/index.html',
  })
  let clicks = 0
  wc.dom.window.document.querySelector('[data-log*="assess_next"]').addEventListener('click', () => { clicks += 1 })

  const result = await adapter.submitCurrentSong()

  assert.equal(result.ok, true)
  assert.equal(clicks, 1)
})

test('inspect: stage-complete page returns phase', async () => {
  const { adapter } = makeAdapter({ html: readFixture('stage-complete.html') })
  const state = await adapter.inspect()
  assert.equal(state.kind, 'stage-complete')
  assert.equal(state.phase, 'daily')
})

test('inspect: live completion dialog returns the daily stage boundary', async () => {
  const html = '<!doctype html><html><body><span>5 / 5</span><h3>评定完成</h3><p>已完成今日5首歌曲的评定</p><div>继续评定</div><div>返回查看更多</div></body></html>'
  const { adapter } = makeAdapter({ html, url: 'https://mp.music.163.com/mission/index.html' })

  const state = await adapter.inspect()

  assert.equal(state.kind, 'stage-complete')
  assert.equal(state.phase, 'daily')
})

test('inspect: daily completion dialog wins over its modal overlay', async () => {
  const { adapter } = makeAdapter({
    html: readFixture('daily-complete-dialog.html'),
    url: 'https://mp.music.163.com/mission/index.html',
  })

  const state = await adapter.inspect()

  assert.deepEqual(state, {
    kind: 'stage-complete',
    phase: 'daily',
    dialogType: 'daily-complete',
    primaryAction: '继续评定',
  })
})

test('inspect: choice dialog is an intervention that requires manual handling', async () => {
  const { adapter, wc } = makeAdapter({
    html: readFixture('intervention-dialog.html'),
    url: 'https://mp.music.163.com/mission/index.html',
  })
  wc.dom.window.document.querySelectorAll('[role="dialog"], .modal-mask').forEach((element) => {
    element.getBoundingClientRect = () => ({ width: 300, height: 240, top: 0, left: 0, right: 300, bottom: 240 })
  })

  const state = await adapter.inspect()

  assert.equal(state.kind, 'intervention')
  assert.equal(state.interventionType, 'choice-required')
  assert.equal(state.canAutoDismiss, false)
})

test('dismissOverlay: never clicks a choice that changes the rating flow', async () => {
  const { adapter, wc } = makeAdapter({
    html: readFixture('intervention-dialog.html'),
    url: 'https://mp.music.163.com/mission/index.html',
  })
  let recommendClicks = 0
  let closeClicks = 0
  wc.dom.window.document.querySelector('.recommend').addEventListener('click', () => { recommendClicks += 1 })
  const close = wc.dom.window.document.querySelector('.close')
  close.getBoundingClientRect = () => ({ width: 24, height: 24, top: 0, left: 0, right: 24, bottom: 24 })
  close.addEventListener('click', () => { closeClicks += 1 })

  const result = await adapter.dismissOverlay()

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'manual-intervention-required')
  assert.equal(recommendClicks, 0)
  assert.equal(closeClicks, 0)
})

test('dismissOverlay: clicks one explicitly safe acknowledgement action', async () => {
  const html = '<!doctype html><html lang="zh-CN"><body><div class="modal"><button type="button" class="ack">我知道了</button></div></body></html>'
  const { adapter, wc } = makeAdapter({ html, url: 'https://mp.music.163.com/mission/index.html' })
  let clicks = 0
  const modal = wc.dom.window.document.querySelector('.modal')
  modal.getBoundingClientRect = () => ({ width: 300, height: 240, top: 0, left: 0, right: 300, bottom: 240 })
  wc.dom.window.document.querySelector('.ack').addEventListener('click', () => { clicks += 1 })

  const state = await adapter.inspect()
  const result = await adapter.dismissOverlay()

  assert.equal(state.kind, 'overlay')
  assert.equal(state.canAutoDismiss, true)
  assert.equal(result.ok, true)
  assert.equal(result.label, '我知道了')
  assert.equal(clicks, 1)
})

test('completeStage: live daily completion clicks continue rating', async () => {
  const html = '<!doctype html><html><body><span>5 / 5</span><h3>评定完成</h3><div class="continue">继续评定</div><div>返回查看更多</div></body></html>'
  const { adapter, wc } = makeAdapter({ html, url: 'https://mp.music.163.com/mission/index.html' })
  let clicks = 0
  wc.dom.window.document.querySelector('.continue').addEventListener('click', () => { clicks += 1 })

  const result = await adapter.completeStage()

  assert.equal(result.ok, true)
  assert.equal(clicks, 1)
})

test('completeStage: nested daily completion control triggers exactly once', async () => {
  const { adapter, wc } = makeAdapter({
    html: readFixture('daily-complete-dialog.html'),
    url: 'https://mp.music.163.com/mission/index.html',
  })
  let clicks = 0
  wc.dom.window.document.querySelector('.continue').addEventListener('click', () => { clicks += 1 })

  const result = await adapter.completeStage()

  assert.equal(result.ok, true)
  assert.equal(clicks, 1)
})

test('inspect: unknown page returns blocked', async () => {
  const html = '<!doctype html><html><body><div>Hello</div></body></html>'
  const { adapter } = makeAdapter({ html })
  const state = await adapter.inspect()
  assert.equal(state.kind, 'blocked')
  assert.equal(state.reason, 'unknown-page')
})

test('inspect: loading placeholder returns a transient loading state', async () => {
  const html = '<!doctype html><html><body><div>加载中</div></body></html>'
  const { adapter } = makeAdapter({ html })

  const state = await adapter.inspect()

  assert.equal(state.kind, 'loading')
})

test('enterTodayTask: clicks the only matching button', async () => {
  const { adapter } = makeAdapter({ html: readFixture('home.html') })
  const result = await adapter.enterTodayTask()
  assert.equal(result.ok, true)
  assert.equal(result.label, PAGE_CONTRACT.enter)
})

test('enterTodayTask: clicks one nested visual control when ancestor divs share its label', async () => {
  const html = `<!doctype html><html><body>
    <div class="outer">
      <div class="control"><div class="label">${PAGE_CONTRACT.enter}</div></div>
    </div>
  </body></html>`
  const { adapter, wc } = makeAdapter({ html })
  let clicks = 0
  wc.dom.window.document.querySelector('.control').addEventListener('click', () => { clicks += 1 })

  const result = await adapter.enterTodayTask()

  assert.equal(result.ok, true)
  assert.equal(clicks, 1)
})

test('enterTodayTask: fails when button missing', async () => {
  const html = '<!doctype html><html><body><button>不匹配的文本</button></body></html>'
  const { adapter } = makeAdapter({ html })
  const result = await adapter.enterTodayTask()
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'target-missing')
})

test('enterTodayTask: fails when button duplicated', async () => {
  const html = `<!doctype html><html><body>
    <button>评定今日歌曲</button>
    <button>评定今日歌曲</button>
  </body></html>`
  const { adapter } = makeAdapter({ html })
  const result = await adapter.enterTodayTask()
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'target-duplicated')
})

test('enterTodayTask: fails when button disabled', async () => {
  const html = '<!doctype html><html><body><button disabled>评定今日歌曲</button></body></html>'
  const { adapter } = makeAdapter({ html })
  const result = await adapter.enterTodayTask()
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'target-disabled')
})

test('clickScore: 总评 stars 3 sets selected score 3', async () => {
  const { adapter, wc } = makeAdapter({ html: readFixture('rating.html') })
  // Pre-program the row's selected marker to update when star is clicked.
  // The fixture's star click handler is simulated by jsdom; we patch
  // readRatingRow's selectedScore by mutating data-value below.
  // We need the click to update [data-marker="selected-score"][data-value].
  // In real NCM H5, clicking a star updates a React state. Here we add a
  // small JS that mirrors the click into the marker before running clickScore.
  wc.dom.window.eval(`
    document.querySelectorAll('.rating-row').forEach(function (row) {
      var label = row.querySelector('.rating-label').textContent.trim();
      var marker = row.querySelector('[data-marker="selected-score"]');
      row.querySelectorAll('.star').forEach(function (star) {
        star.addEventListener('click', function () {
          var score = star.getAttribute('data-score');
          marker.setAttribute('data-value', score);
          marker.textContent = score + ' 分';
        });
      });
    });
  `)
  const result = await adapter.clickScore('总评', 3)
  assert.equal(result.ok, true)
  assert.equal(result.label, '总评')
  assert.equal(result.score, 3)
  assert.equal(result.confirmedScore, 3)
})

test('clickScore: part row 旋律 star 4 sets selected score 4', async () => {
  const { adapter, wc } = makeAdapter({ html: readFixture('rating.html') })
  wc.dom.window.eval(`
    document.querySelectorAll('.rating-row.part-row').forEach(function (row) {
      var marker = row.querySelector('[data-marker="selected-score"]');
      row.querySelectorAll('.star').forEach(function (star) {
        star.addEventListener('click', function () {
          marker.setAttribute('data-value', star.getAttribute('data-score'));
        });
      });
    });
  `)
  const result = await adapter.clickScore('旋律', 4)
  assert.equal(result.ok, true)
  assert.equal(result.label, '旋律')
  assert.equal(result.confirmedScore, 4)
})

test('clickScore: fails when row missing', async () => {
  const html = '<!doctype html><html><body></body></html>'
  const { adapter } = makeAdapter({ html })
  const result = await adapter.clickScore('总评', 3)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'row-missing')
})

test('clickScore: fails when star score not found', async () => {
  // Fixture with only 3 stars but we ask for score 5
  const html = `<!doctype html><html><body>
    <div class="rating-row overall-row" data-rating="overall">
      <div class="rating-label">总评</div>
      <div class="rating-stars">
        <span class="star" data-score="1">★</span>
        <span class="star" data-score="2">★</span>
        <span class="star" data-score="3">★</span>
      </div>
      <div class="rating-selected" data-marker="selected-score" data-value=""></div>
    </div>
  </body></html>`
  const { adapter } = makeAdapter({ html })
  const result = await adapter.clickScore('总评', 5)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'star-missing')
})

test('clickScore: fails when select-not-confirmed (click did not update marker)', async () => {
  const { adapter } = makeAdapter({ html: readFixture('rating.html') })
  // No JS to update the marker on click — readRatingRow's selectedScore stays null.
  const result = await adapter.clickScore('总评', 4)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'select-not-confirmed')
})

test('clickScore: rejects invalid label', async () => {
  const { adapter } = makeAdapter({ html: readFixture('rating.html') })
  const result = await adapter.clickScore('', 3)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'invalid-label')
})

test('clickScore: rejects invalid score', async () => {
  const { adapter } = makeAdapter({ html: readFixture('rating.html') })
  const r1 = await adapter.clickScore('总评', 0)
  assert.equal(r1.ok, false)
  assert.equal(r1.reason, 'invalid-score')
  const r2 = await adapter.clickScore('总评', 6)
  assert.equal(r2.ok, false)
  assert.equal(r2.reason, 'invalid-score')
  const r3 = await adapter.clickScore('总评', 4.5)
  assert.equal(r3.ok, false)
  assert.equal(r3.reason, 'invalid-score')
})

test('submitCurrentSong: clicks the only matching button', async () => {
  const { adapter } = makeAdapter({ html: readFixture('rating.html') })
  const result = await adapter.submitCurrentSong()
  assert.equal(result.ok, true)
  assert.equal(result.label, PAGE_CONTRACT.submit)
})

test('submitCurrentSong: fails when button absent', async () => {
  const { adapter } = makeAdapter({ html: readFixture('home.html') })
  const result = await adapter.submitCurrentSong()
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'target-missing')
})

test('completeStage: clicks the only matching button', async () => {
  const { adapter } = makeAdapter({ html: readFixture('stage-complete.html') }
  )
  const result = await adapter.completeStage()
  assert.equal(result.ok, true)
  assert.equal(result.label, PAGE_CONTRACT.complete)
})

test('completeStage: fails when button absent', async () => {
  const { adapter } = makeAdapter({ html: readFixture('home.html') })
  const result = await adapter.completeStage()
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'target-missing')
})

test('inspect: blocked when URL leaves allowed origin', async () => {
  const { adapter } = makeAdapter({
    html: readFixture('home.html'),
    url: 'https://evil.example.com/home.html',
  })
  const state = await adapter.inspect()
  assert.equal(state.kind, 'blocked')
  assert.equal(state.reason, 'unexpected-url')
})

test('all actions: blocked when URL leaves allowed origin', async () => {
  const { adapter } = makeAdapter({
    html: readFixture('home.html'),
    url: 'https://music.163.com/stolen.html',
  })
  const r1 = await adapter.enterTodayTask()
  assert.equal(r1.ok, false)
  assert.equal(r1.reason, 'unexpected-url')
  const r2 = await adapter.clickScore('总评', 3)
  assert.equal(r2.ok, false)
  assert.equal(r2.reason, 'unexpected-url')
  const r3 = await adapter.submitCurrentSong()
  assert.equal(r3.ok, false)
  assert.equal(r3.reason, 'unexpected-url')
  const r4 = await adapter.completeStage()
  assert.equal(r4.ok, false)
  assert.equal(r4.reason, 'unexpected-url')
})

test('all actions: blocked when webContents is gone (window closed)', async () => {
  let returnNull = false
  const adapter = createPageAdapter({
    getWebContents: () => (returnNull ? null : { executeJavaScript: () => Promise.resolve({ ok: true }) }),
    getUrl: () => 'https://mp.music.163.com/home',
  })
  returnNull = true
  const r1 = await adapter.enterTodayTask()
  assert.equal(r1.ok, false)
  assert.equal(r1.reason, 'window-closed')
})

test('inspect: rating page with three parts reads all three', async () => {
  // Add a third part row (歌词) by manipulating the live DOM via jsdom.
  const { adapter, wc } = makeAdapter({ html: readFixture('rating.html') })
  wc.dom.window.eval(`
    var section = document.querySelector('.rating-board');
    var last = section.querySelector('.rating-row.part-row[data-part-name="演唱"]');
    var third = last.cloneNode(true);
    third.setAttribute('data-part-name', '歌词');
    third.querySelector('.rating-label').textContent = '歌词';
    third.querySelector('[data-marker="selected-score"]').setAttribute('data-value', '');
    third.querySelector('[data-marker="selected-score"]').textContent = '未选择';
    section.appendChild(third);
  `)
  const state = await adapter.inspect()
  assert.equal(state.kind, 'rating')
  assert.deepEqual(state.partNames, ['旋律', '演唱', '歌词'])
})

test('inspect: rating page with single part reads only that part', async () => {
  // Remove the 演唱 part row from the live DOM.
  const { adapter, wc } = makeAdapter({ html: readFixture('rating.html') })
  wc.dom.window.eval(`
    var row = document.querySelector('.rating-row.part-row[data-part-name="演唱"]');
    row.parentNode.removeChild(row);
  `)
  const state = await adapter.inspect()
  assert.equal(state.kind, 'rating')
  assert.deepEqual(state.partNames, ['旋律'])
})

test('inspect: rating page with no overall row returns blocked', async () => {
  // Remove the overall row from the live DOM.
  const { adapter, wc } = makeAdapter({ html: readFixture('rating.html') })
  wc.dom.window.eval(`
    var row = document.querySelector('.rating-row.overall-row');
    row.parentNode.removeChild(row);
  `)
  const state = await adapter.inspect()
  assert.equal(state.kind, 'blocked')
  assert.equal(state.reason, 'missing-overall-row')
})

test('inspect: rating page without song-id returns blocked', async () => {
  const html = readFixture('rating.html').replace('data-song-id="song-001"', 'data-song-id=""')
  const { adapter } = makeAdapter({ html })
  const state = await adapter.inspect()
  assert.equal(state.kind, 'blocked')
  assert.equal(state.reason, 'missing-song-id')
})

test('PAGE_CONTRACT is frozen and exposes required labels', () => {
  assert.equal(PAGE_CONTRACT.enter, '评定今日歌曲')
  assert.equal(PAGE_CONTRACT.submit, '提交并进入下首歌曲')
  assert.equal(PAGE_CONTRACT.complete, '完成评定')
  assert.equal(PAGE_CONTRACT.overall, '总评')
  assert.deepEqual(PAGE_CONTRACT.knownParts, ['旋律', '演唱', '歌词'])
  assert.ok(Object.isFrozen(PAGE_CONTRACT))
  assert.ok(Object.isFrozen(PAGE_CONTRACT.knownParts))
})

test('createPageAdapter: throws when required deps missing', () => {
  assert.throws(() => createPageAdapter(null), /getWebContents and getUrl are required/)
  assert.throws(() => createPageAdapter({ getWebContents: () => null }), /getWebContents and getUrl are required/)
  assert.throws(() => createPageAdapter({ getUrl: () => '' }), /getWebContents and getUrl are required/)
})
