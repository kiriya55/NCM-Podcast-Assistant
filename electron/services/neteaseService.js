const fetch = require('node-fetch')
const { session } = require('electron')
const { weapi } = require('./crypto')

const BASE_URL = 'https://music.163.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

class NeteaseService {
  constructor(cookieStore) {
    this.cookieStore = cookieStore
    this.cookies = cookieStore.getCookies() || {}
    this._session = session.defaultSession
  }

  getCookies() {
    return this.cookies
  }

  updateCookies(cookies) {
    this.cookies = cookies || {}
    this.ensureSession()
    this._syncCookiesToSession().catch(() => {})
  }

  ensureSession() {
    if (!this.cookies['os']) this.cookies['os'] = 'pc'
    if (!this.cookies['appver']) this.cookies['appver'] = '2.10.15'
    if (!this.cookies['channel']) this.cookies['channel'] = 'netease'
  }

  _csrf() {
    return this.cookies['__csrf'] || ''
  }

  _cookieString() {
    return this.cookieStore.getCookieString()
  }

  async _syncCookiesToSession() {
    try {
      for (const [name, value] of Object.entries(this.cookies)) {
        await this._session.cookies.set({
          url: BASE_URL,
          name,
          value,
          domain: '.music.163.com',
          path: '/',
          httpOnly: false,
          secure: true,
        })
      }
    } catch (e) {
      console.error(`[${this.constructor.name}] Sync cookies error:`, e.message)
    }
  }

  _parseCookieString(str) {
    if (!str) return
    const pairs = str.split(';').map(s => s.trim()).filter(Boolean)
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=')
      if (eqIdx > 0) {
        this.cookies[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1)
      }
    }
  }

  _parseCookies(setCookieHeaders) {
    if (!setCookieHeaders) return
    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders]
    for (const header of headers) {
      const cookieStr = header.split(';')[0].trim()
      const eqIdx = cookieStr.indexOf('=')
      if (eqIdx > 0) {
        const key = cookieStr.slice(0, eqIdx).trim()
        const val = cookieStr.slice(eqIdx + 1).trim()
        if (key && val) {
          this.cookies[key] = val
        }
      }
    }
    this.cookieStore.setCookies(this.cookies)
  }

  async _postWeapi(urlPath, data, timeout = 15000, host = BASE_URL) {
    const csrf = this._csrf()
    const payload = { ...data, csrf_token: csrf }
    const { params, encSecKey } = weapi(payload)
    const body = `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      const res = await fetch(`${host}${urlPath}?csrf_token=${csrf}`, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://music.163.com/',
          'Origin': 'https://music.163.com',
          'Cookie': this._cookieString(),
        },
        body,
        signal: controller.signal,
      })

      this._parseCookies(res.headers.raw()['set-cookie'])
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }
}

module.exports = {
  BASE_URL,
  UA,
  NeteaseService,
}
