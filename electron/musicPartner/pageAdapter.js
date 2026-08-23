'use strict'

// add some func

const PAGE_CONTRACT = Object.freeze({
  enter: '评定今日歌曲',
  submit: '提交并进入下首歌曲',
  complete: '完成评定',
  overall: '总评',
  knownParts: Object.freeze(['旋律', '演唱', '歌词']),
  dismissLabels: Object.freeze(['我知道了', '知道了', '关闭']),
})

const DEFAULT_ALLOWED_ORIGIN = 'https://mp.music.163.com'

// add some func

function createPageAdapter(deps) {
  if (!deps || typeof deps.getWebContents !== 'function' || typeof deps.getUrl !== 'function') {
    throw new Error('createPageAdapter: getWebContents and getUrl are required functions')
  }
  const allowedOrigin = (deps.allowedOrigin || DEFAULT_ALLOWED_ORIGIN).replace(/\/$/, '')

  async function run(script) {
    const wc = deps.getWebContents()
    if (!wc || typeof wc.executeJavaScript !== 'function') {
      return { ok: false, reason: 'window-closed', lastAction: 'run' }
    }
    const url = deps.getUrl()
    if (typeof url !== 'string' || !url.startsWith(allowedOrigin)) {
      return { ok: false, reason: 'unexpected-url', lastAction: 'run', url: url || '' }
    }
    try {
      const raw = await wc.executeJavaScript(script)
      // add some func
      if (raw === undefined || raw === null) return raw
      return JSON.parse(JSON.stringify(raw))
    } catch (err) {
      return { ok: false, reason: 'execute-failed', message: String(err && err.message || err), lastAction: 'run' }
    }
  }

  // add some func
  async function inspect() {
    const result = await run(`(function () {
      ${PAGE_ADAPTER_HELPERS}
      return inspectPage(${JSON.stringify(PAGE_CONTRACT)});
    })()`)
    if (!result || result.ok === false) {
      return {
        kind: 'blocked',
        reason: (result && result.reason) || 'inspect-failed',
        ...(result && result.message ? { message: result.message } : {}),
      }
    }
    return result.state
  }

  // add some func
  async function enterTodayTask() {
    return run(`(function () {
      ${PAGE_ADAPTER_HELPERS}
      return clickByLabelText(${JSON.stringify(PAGE_CONTRACT.enter)});
    })()`)
  }

  async function continueRating() {
    return run(`(function () {
      ${PAGE_ADAPTER_HELPERS}
      return clickByLabelText('继续评定');
    })()`)
  }

  // add some func
  async function clickScore(label, score) {
    if (typeof label !== 'string' || label.length === 0) {
      return { ok: false, reason: 'invalid-label', lastAction: 'clickScore' }
    }
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return { ok: false, reason: 'invalid-score', lastAction: 'clickScore' }
    }
    return run(`(function () {
      ${PAGE_ADAPTER_HELPERS}
      return clickStar(${JSON.stringify(label)}, ${score});
    })()`)
  }

  // add some func
  async function submitCurrentSong() {
    return run(`(function () {
      ${PAGE_ADAPTER_HELPERS}
      var liveSubmit = clickByDataLogOid('btn_web_music_partner_miniprogram_assess_next');
      if (liveSubmit.ok || liveSubmit.reason !== 'target-missing') return liveSubmit;
      return clickByLabelText(${JSON.stringify(PAGE_CONTRACT.submit)});
    })()`)
  }

  // add some func
  async function completeStage() {
    return run(`(function () {
      ${PAGE_ADAPTER_HELPERS}
      var liveContinue = clickByLabelText('继续评定');
      if (liveContinue.ok || liveContinue.reason !== 'target-missing') return liveContinue;
      return clickByLabelText(${JSON.stringify(PAGE_CONTRACT.complete)});
    })()`)
  }

  // add some func
  async function dismissOverlay() {
    return run(`(function () {
      ${PAGE_ADAPTER_HELPERS}
      return dismissOverlay(${JSON.stringify(PAGE_CONTRACT.dismissLabels)});
    })()`)
  }

  return {
    PAGE_CONTRACT,
    inspect,
    enterTodayTask,
    continueRating,
    clickScore,
    submitCurrentSong,
    completeStage,
    dismissOverlay,
  }
}

// add some func

const PAGE_ADAPTER_HELPERS = `
function pageKind() {
  var page = document.querySelector('[data-page]');
  if (!page) return null;
  return page.getAttribute('data-page');
}

function readRatingRow(label) {
  // add some func
  var rows = document.querySelectorAll('.rating-row');
  var matched = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var labelEl = row.querySelector('.rating-label');
    if (labelEl && labelEl.textContent.trim() === label) {
      matched.push(row);
    }
  }
  if (matched.length !== 1) return null;
  var row = matched[0];
  var stars = row.querySelectorAll('.star');
  if (stars.length === 0) return null;
  var selectedEl = row.querySelector('[data-marker="selected-score"]');
  var selectedValue = selectedEl ? selectedEl.getAttribute('data-value') : '';
  var selectedScore = parseInt(selectedValue, 10);
  if (!Number.isInteger(selectedScore)) selectedScore = null;
  return { row: row, stars: stars, selectedScore: selectedScore };
}

function readPlayback() {
  var audio = document.querySelector('audio');
  if (!audio) return { available: false, playing: false, currentTime: 0, duration: 0 };
  var stateEl = document.querySelector('[data-marker="play-state"]');
  var state = stateEl ? stateEl.getAttribute('data-state') : '';
  var ctEl = document.querySelector('[data-marker="current-time"]');
  var durEl = document.querySelector('[data-marker="duration"]');
  var currentTime = 0, duration = 0;
  if (ctEl) { var ct = parseFloat(ctEl.textContent.trim()); if (Number.isFinite(ct)) currentTime = ct; }
  if (durEl) { var du = parseFloat(durEl.textContent.trim()); if (Number.isFinite(du)) duration = du; }
  // add some func
  if (Number.isFinite(audio.currentTime)) currentTime = audio.currentTime;
  if (Number.isFinite(audio.duration) && audio.duration > 0) duration = audio.duration;
  var playing = !audio.paused && !audio.ended;
  if (state === 'playing') playing = true;
  if (state === 'paused') playing = false;
  return { available: true, playing: playing, currentTime: Math.max(0, currentTime), duration: Math.max(0, duration) };
}

function readSongInfo() {
  var page = document.querySelector('[data-page="rating"]');
  if (!page) return null;
  var songId = page.getAttribute('data-song-id') || '';
  var songIndex = parseInt(page.getAttribute('data-song-index') || '0', 10);
  var phase = page.getAttribute('data-phase') || '';
  var nameEl = document.querySelector('.song-name');
  var authorEl = document.querySelector('.song-author');
  return {
    songId: songId,
    songIndex: Number.isInteger(songIndex) ? songIndex : null,
    phase: phase,
    name: nameEl ? nameEl.textContent.trim() : '',
    author: authorEl ? authorEl.textContent.trim() : '',
  }
}

function readPartNames() {
  var parts = [];
  var rows = document.querySelectorAll('.rating-row.part-row');
  for (var i = 0; i < rows.length; i++) {
    var name = rows[i].getAttribute('data-part-name');
    if (name) parts.push(name);
  }
  return parts;
}

function findLiveStarLists() {
  return Array.prototype.filter.call(document.querySelectorAll('ul'), function (list) {
    var items = list.children;
    if (items.length !== 5) return false;
    for (var i = 0; i < items.length; i++) {
      if (items[i].tagName !== 'LI' || items[i].textContent.trim() !== '') return false;
    }
    return true;
  });
}

function findLivePartName(list, knownParts) {
  var container = list.parentElement;
  for (var depth = 0; container && depth < 3; depth++, container = container.parentElement) {
    var descendants = container.querySelectorAll('div, p, span');
    for (var i = 0; i < descendants.length; i++) {
      var text = descendants[i].textContent.trim();
      if (knownParts.indexOf(text) !== -1) return text;
    }
  }
  return null;
}

function readLiveRatingPage(contract) {
  var page = document.querySelector('[data-log*="page_web_music_partner_miniprogram_assess"]');
  var lists = findLiveStarLists();
  if (!page || lists.length === 0 || !document.querySelector('audio')) return null;
  var rawLog = page.getAttribute('data-log') || '';
  var songId = '';
  try {
    var parsedLog = JSON.parse(rawLog);
    songId = parsedLog && parsedLog.params && parsedLog.params.s_cid != null ? String(parsedLog.params.s_cid) : '';
  } catch (_) {}
  if (!songId) return null;
  var counter = null;
  var counterElements = document.querySelectorAll('span, div');
  for (var i = 0; i < counterElements.length; i++) {
    var match = counterElements[i].textContent.trim().match(/^(\\d+)\\s*\\/\\s*(5|15)$/);
    if (match) { counter = { current: parseInt(match[1], 10), total: parseInt(match[2], 10) }; break; }
  }
  var title = page.querySelector('h4');
  var author = title && title.parentElement ? title.parentElement.querySelector('p') : null;
  var partNames = [];
  for (var listIndex = 1; listIndex < lists.length; listIndex++) {
    var partName = findLivePartName(lists[listIndex], contract.knownParts);
    if (partName && partNames.indexOf(partName) === -1) partNames.push(partName);
  }
  var phase = counter && counter.total === 5 ? 'daily' : 'extra';
  var selectedScores = { overall: null, parts: {} };
  for (var scoreIndex = 0; scoreIndex < lists.length; scoreIndex++) {
    var selectedCount = 0;
    for (var starIndex = 0; starIndex < lists[scoreIndex].children.length; starIndex++) {
      if (lists[scoreIndex].children[starIndex].className.indexOf('selected') !== -1) selectedCount++;
    }
    if (scoreIndex === 0) selectedScores.overall = selectedCount || null;
    else {
      var selectedPartName = findLivePartName(lists[scoreIndex], contract.knownParts);
      if (selectedPartName && selectedCount) selectedScores.parts[selectedPartName] = selectedCount;
    }
  }
  var song = {
    songId: songId,
    songIndex: counter ? counter.current - 1 : null,
    phase: phase,
    name: title ? title.textContent.trim() : '',
    author: author ? author.textContent.trim() : '',
  };
  return {
    kind: 'rating', songId: songId, song: song, partNames: partNames,
    playback: readPlayback(), selectedScores: selectedScores,
    progress: { current: counter ? counter.current : null, total: counter ? counter.total : 15, known: !!counter }
  };
}

function readLiveStageComplete() {
  var bodyText = document.body ? document.body.textContent : '';
  if (bodyText.indexOf('评定完成') === -1 || bodyText.indexOf('继续评定') === -1) return null;
  var elements = document.querySelectorAll('span, div');
  for (var i = 0; i < elements.length; i++) {
    var match = elements[i].textContent.trim().match(/^(\\d+)\\s*\\/\\s*(5|15)$/);
    if (match) return {
      kind: 'stage-complete',
      phase: match[2] === '5' ? 'daily' : 'extra',
      dialogType: match[2] === '5' ? 'daily-complete' : 'extra-complete',
      primaryAction: '继续评定',
    };
  }
  return null;
}

function readInterventionState(dismissLabels) {
  if (!isOverlayVisible()) return null;
  var containers = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="dialog"], [class*="popup"], [class*="overlay"], [class*="mask"]');
  var actions = [];
  for (var i = 0; i < containers.length; i++) {
    var buttons = containers[i].querySelectorAll('button, [role="button"], [class*="btn"], a');
    for (var j = 0; j < buttons.length; j++) {
      var text = buttons[j].textContent.trim();
      if (text && actions.indexOf(text) === -1) actions.push(text);
    }
  }
  var canAutoDismiss = actions.some(function (action) { return dismissLabels.indexOf(action) !== -1; });
  if (canAutoDismiss) return { kind: 'overlay', overlayType: 'dismissible', canAutoDismiss: true };
  return { kind: 'intervention', interventionType: 'choice-required', canAutoDismiss: false, actions: actions };
}

function inspectPage(contract) {
  var liveStageComplete = readLiveStageComplete();
  if (liveStageComplete) return { ok: true, state: liveStageComplete };

  var intervention = readInterventionState(contract.dismissLabels);
  if (intervention) return { ok: true, state: intervention };

  var kind = pageKind();
  var debugInfo = { dataPage: kind };

  var liveRating = readLiveRatingPage(contract);
  if (liveRating) return { ok: true, state: liveRating };

  if (kind === 'home') {
    // add some func
    var enterBtn = null;
    var clickables = document.querySelectorAll('button, [role="button"], [class*="btn"], [class*="button"], div[class], span[class]');
    for (var i = 0; i < clickables.length; i++) {
      if (clickables[i].textContent.trim().indexOf(contract.enter) !== -1) {
        enterBtn = clickables[i];
        break;
      }
    }
    var hasContinueButton = document.body && document.body.textContent.indexOf('继续评定') !== -1;
    return { ok: true, state: { kind: 'home', hasEnterButton: !!enterBtn, hasContinueButton: hasContinueButton } };
  }
  if (kind === 'stage-complete') {
    var page = document.querySelector('[data-page="stage-complete"]');
    var phase = page ? page.getAttribute('data-phase') || '' : '';
    return { ok: true, state: { kind: 'stage-complete', phase: phase } };
  }
  if (kind === 'rating') {
    var song = readSongInfo();
    if (!song || !song.songId) return { ok: true, state: { kind: 'blocked', reason: 'missing-song-id' } };
    var partNames = readPartNames();
    var overallRow = readRatingRow(contract.overall);
    if (!overallRow) return { ok: true, state: { kind: 'blocked', reason: 'missing-overall-row' } };
    var playback = readPlayback();
    var selectedScores = { overall: overallRow.selectedScore, parts: {} };
    for (var partIndex = 0; partIndex < partNames.length; partIndex++) {
      var partRow = readRatingRow(partNames[partIndex]);
      if (partRow && partRow.selectedScore != null) selectedScores.parts[partNames[partIndex]] = partRow.selectedScore;
    }
    var progressCurrent = Number.isInteger(song.songIndex) ? song.songIndex + 1 : null;
    var progressTotal = song.phase === 'daily' ? 5 : 15;
    return {
      ok: true,
      state: {
        kind: 'rating',
        songId: song.songId,
        song: song,
        partNames: partNames,
        playback: playback,
        selectedScores: selectedScores,
        progress: { current: progressCurrent, total: progressTotal, known: progressCurrent != null },
      },
    };
  }

  // add some func
  var bodyText = document.body ? document.body.textContent : '';
  var visibleBodyText = document.body && typeof document.body.innerText === 'string' ? document.body.innerText : bodyText;
  var bodySnippet = bodyText.substring(0, 500);

  if (visibleBodyText.trim() === '加载中') {
    return { ok: true, state: { kind: 'loading' } };
  }

  // add some func
  if (bodyText.indexOf('周总结') !== -1 || bodyText.indexOf('周报') !== -1 || bodyText.indexOf('总结报告') !== -1) {
    return { ok: true, state: { kind: 'overlay' } };
  }

  // add some func
  if (bodyText.indexOf('评定今日歌曲') !== -1 || bodyText.indexOf('继续评定') !== -1 || bodyText.indexOf('音乐合伙人') !== -1) {
    // add some func
    var enterBtn = null;
    var clickables = document.querySelectorAll('button, [role="button"], [class*="btn"], [class*="button"], div[class], span[class]');
    for (var i = 0; i < clickables.length; i++) {
      var btnText = clickables[i].textContent.trim();
      if (btnText.indexOf(contract.enter) !== -1) {
        enterBtn = clickables[i];
        break;
      }
    }
    return {
      ok: true,
      state: {
        kind: 'home',
        hasEnterButton: !!enterBtn,
        hasContinueButton: bodyText.indexOf('继续评定') !== -1,
      },
    };
  }

  // add some func
  if (bodyText.indexOf('总评') !== -1 || bodyText.indexOf('旋律') !== -1 || bodyText.indexOf('演唱') !== -1) {
    // add some func
    var song = readSongInfo();
    if (song && song.songId) {
      var partNames = readPartNames();
      var overallRow = readRatingRow(contract.overall);
      if (overallRow) {
        var playback = readPlayback();
        return {
          ok: true,
          state: {
            kind: 'rating',
            songId: song.songId,
            song: song,
            partNames: partNames,
            playback: playback,
          },
        };
      }
    }
  }

  // add some func
  return { ok: true, state: { kind: 'blocked', reason: 'unknown-page', debug: debugInfo, bodySnippet: bodySnippet } };
}

function clickByLabelText(labelText) {
  // add some func
  var selectors = 'button, [role="button"], [class*="btn"], [class*="button"], div[class], span[class]';
  var elements = document.querySelectorAll(selectors);
  var exactMatches = [];
  var containsMatches = [];
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var text = el.textContent.trim();
    if (text === labelText) {
      exactMatches.push(el);
    } else if (text.indexOf(labelText) !== -1) {
      containsMatches.push(el);
    }
  }
  var leafExactMatches = exactMatches.filter(function (candidate) {
    return !exactMatches.some(function (other) {
      return other !== candidate && candidate.contains(other);
    });
  });
  // add some func
  var matched = leafExactMatches.length > 0 ? leafExactMatches : containsMatches;
  if (matched.length === 0) return { ok: false, reason: 'target-missing', lastAction: 'click-text', searched: labelText };
  if (matched.length > 1) {
    // add some func
    if (leafExactMatches.length > 1) {
      return { ok: false, reason: 'target-duplicated', lastAction: 'click-text' };
    }
    // add some func
    matched.sort(function(a, b) { return a.textContent.trim().length - b.textContent.trim().length; });
  }
  var target = matched[0];
  if (target.disabled) return { ok: false, reason: 'target-disabled', lastAction: 'click-text' };
  target.click();
  return { ok: true, lastAction: 'click-text', label: labelText };
}

function clickByDataLogOid(oid) {
  var candidates = document.querySelectorAll('[data-log*="' + oid + '"]');
  var matched = [];
  for (var i = 0; i < candidates.length; i++) {
    try {
      var value = JSON.parse(candidates[i].getAttribute('data-log') || '');
      if (value && value.oid === oid) matched.push(candidates[i]);
    } catch (_) {}
  }
  if (matched.length === 0) return { ok: false, reason: 'target-missing', lastAction: 'click-data-log', oid: oid };
  if (matched.length > 1) return { ok: false, reason: 'target-duplicated', lastAction: 'click-data-log', oid: oid };
  matched[0].click();
  return { ok: true, lastAction: 'click-data-log', oid: oid };
}

function clickStar(label, score) {
  var row = readRatingRow(label);
  if (!row) {
    var liveLists = findLiveStarLists();
    var liveList = null;
    if (label === '总评') {
      liveList = liveLists[0] || null;
    } else {
      for (var liveIndex = 1; liveIndex < liveLists.length; liveIndex++) {
        if (findLivePartName(liveLists[liveIndex], ${JSON.stringify(PAGE_CONTRACT.knownParts)}) === label) {
          liveList = liveLists[liveIndex];
          break;
        }
      }
    }
    if (!liveList) return { ok: false, reason: 'row-missing', lastAction: 'click-star', label: label };
    var liveStars = liveList.children;
    var initialClass = liveStars[0].className;
    liveStars[score - 1].click();
    var refreshedLists = findLiveStarLists();
    var refreshedList = label === '总评' ? refreshedLists[0] : null;
    if (!refreshedList) {
      for (var refreshedIndex = 1; refreshedIndex < refreshedLists.length; refreshedIndex++) {
        if (findLivePartName(refreshedLists[refreshedIndex], ${JSON.stringify(PAGE_CONTRACT.knownParts)}) === label) {
          refreshedList = refreshedLists[refreshedIndex];
          break;
        }
      }
    }
    var confirmedScore = 0;
    if (label === '总评') {
      var ratingTextElements = document.querySelectorAll('p');
      for (var textIndex = 0; textIndex < ratingTextElements.length; textIndex++) {
        var ratingMatch = ratingTextElements[textIndex].textContent.trim().match(/^([1-5])星/);
        if (ratingMatch) { confirmedScore = parseInt(ratingMatch[1], 10); break; }
      }
    } else if (refreshedList) {
      while (confirmedScore < refreshedList.children.length && refreshedList.children[confirmedScore].className !== initialClass) confirmedScore++;
    }
    if (confirmedScore !== score) return { ok: false, reason: 'select-not-confirmed', lastAction: 'click-star', label: label, score: score };
    return { ok: true, lastAction: 'click-star', label: label, score: score, confirmedScore: confirmedScore };
  }
  var star = null;
  for (var i = 0; i < row.stars.length; i++) {
    var s = row.stars[i];
    var sScore = parseInt(s.getAttribute('data-score'), 10);
    if (Number.isInteger(sScore) && sScore === score) { star = s; break; }
  }
  if (!star) return { ok: false, reason: 'star-missing', lastAction: 'click-star', label: label, score: score };
  star.click();
  // add some func
  var after = readRatingRow(label);
  var confirmedScore = after ? after.selectedScore : null;
  if (!Number.isInteger(confirmedScore)) {
    return { ok: false, reason: 'select-not-confirmed', lastAction: 'click-star', label: label, score: score };
  }
  return { ok: true, lastAction: 'click-star', label: label, score: score, confirmedScore: confirmedScore };
}

function isOverlayVisible() {
  // add some func
  var modals = document.querySelectorAll('[class*="modal"], [class*="dialog"], [class*="popup"], [class*="overlay"], [class*="mask"]');
  for (var i = 0; i < modals.length; i++) {
    var el = modals[i];
    var style = window.getComputedStyle(el);
    if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
      var rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return true;
      }
    }
  }
  // add some func
  var allElements = document.querySelectorAll('*');
  for (var i = 0; i < allElements.length; i++) {
    var el = allElements[i];
    var style = window.getComputedStyle(el);
    if ((style.position === 'fixed' || style.position === 'absolute') && style.zIndex > 100) {
      var rect = el.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 100) {
        // add some func
        var text = el.textContent || '';
        if (text.indexOf('周总结') !== -1 || text.indexOf('报告') !== -1 || text.indexOf('总结') !== -1) {
          return true;
        }
      }
    }
  }
  return false;
}

function dismissOverlay(dismissLabels) {
  // add some func
  var overlaySelectors = '[class*="modal"], [class*="dialog"], [class*="popup"], [class*="overlay"], [class*="mask"], [class*="tip"], [class*="guide"]';
  var containers = document.querySelectorAll(overlaySelectors);
  var hadVisibleContainer = false;

  for (var c = 0; c < containers.length; c++) {
    var container = containers[c];
    var style = window.getComputedStyle(container);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    hadVisibleContainer = true;

    // add some func
    var buttons = container.querySelectorAll('button, [class*="btn"], [class*="close"], a');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var btnText = btn.textContent.trim();
      for (var j = 0; j < dismissLabels.length; j++) {
        if (btnText === dismissLabels[j]) {
          btn.click();
          return { ok: true, lastAction: 'dismiss-overlay', label: btnText };
        }
      }
    }

  }

  // add some func
  var allElements = document.querySelectorAll('div, section');
  for (var i = 0; i < allElements.length; i++) {
    var el = allElements[i];
    var text = el.textContent || '';
    if ((text.indexOf('周总结') !== -1 || text.indexOf('周报') !== -1) && text.length < 2000) {
      var style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'absolute') {
        // add some func
        var buttons = el.querySelectorAll('button, [class*="btn"]');
        for (var j = 0; j < buttons.length; j++) {
          var btn = buttons[j];
          var btnText = btn.textContent.trim();
          for (var k = 0; k < dismissLabels.length; k++) {
            if (btnText === dismissLabels[k]) {
              btn.click();
              return { ok: true, lastAction: 'dismiss-overlay', label: btnText };
            }
          }
        }
      }
    }
  }

  if (hadVisibleContainer || isOverlayVisible()) return { ok: false, reason: 'manual-intervention-required', lastAction: 'dismiss-overlay' };
  return { ok: false, reason: 'no-overlay', lastAction: 'dismiss-overlay' };
}
`

module.exports = {
  createPageAdapter,
  PAGE_CONTRACT,
  PAGE_ADAPTER_HELPERS,
}
