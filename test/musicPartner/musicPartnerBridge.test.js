'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')

const { createMusicPartnerBridgeScript } = require('../../electron/musicPartnerBridge')
const { isAllowedPartnerNavigation } = require('../../electron/musicPartner/navigationPolicy')

test('navigator.openURL blocks external app protocols when the H5 page mis-clicks', () => {
  // Given: the partner page bridge is installed with an observable Electron shell.
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://mp.music.163.com/home/index.html',
    runScripts: 'dangerously',
  })
  const openedUrls = []
  dom.window.require = () => ({ shell: { openExternal: url => openedUrls.push(url) } })
  dom.window.eval(createMusicPartnerBridgeScript({ nickname: 'QA', userId: '1' }))

  // When: a stray H5 action requests the NetEase desktop-app protocol.
  const response = dom.window.prompt(JSON.stringify({
    method: 'navigator.openURL',
    params: { url: 'orpheus://song/123' },
    seq: 1,
  }))

  // Then: the bridge acknowledges the request without launching the OS handler.
  assert.deepEqual(openedUrls, [])
  assert.equal(JSON.parse(response).code, 200)
})

test('navigation policy allows only HTTPS NetEase Music web pages', () => {
  // Given: URLs that cover the trusted page, desktop-app protocol, and spoofed host.
  const cases = [
    ['https://mp.music.163.com/mission/index.html', true],
    ['https://music.163.com/song?id=123', true],
    ['orpheus://song/123', false],
    ['https://evil.example/?next=music.163.com', false],
    ['javascript:alert(1)', false],
  ]

  // When: each URL crosses the BrowserWindow navigation boundary.
  const decisions = cases.map(([url]) => isAllowedPartnerNavigation(url))

  // Then: only trusted HTTPS NetEase hosts remain inside the partner window.
  assert.deepEqual(decisions, cases.map(([, expected]) => expected))
})
