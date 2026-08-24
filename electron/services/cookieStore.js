const Store = require('electron-store')

const schema = {
  cookies: { type: 'object', default: {} },
  token: { type: 'string', default: '' },
  userId: { type: 'string', default: '' },
  nickname: { type: 'string', default: '' },
}

class CookieStore {
  constructor({ cwd } = {}) {
    this.store = new Store({ name: 'cookies', schema, ...(cwd ? { cwd } : {}) })
  }

  getCookies() {
    return this.store.get('cookies') || {}
  }

  setCookies(cookies) {
    this.store.set('cookies', cookies)
  }

  getToken() {
    return this.store.get('token') || ''
  }

  setToken(token) {
    this.store.set('token', token)
  }

  getUserId() {
    return this.store.get('userId') || ''
  }

  setUserId(userId) {
    this.store.set('userId', userId)
  }

  getNickname() {
    return this.store.get('nickname') || ''
  }

  setNickname(nickname) {
    this.store.set('nickname', nickname)
  }

  getCookieString() {
    const cookies = this.getCookies()
    return Object.entries(cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ')
  }

  clear() {
    this.store.clear()
  }
}

module.exports = CookieStore
