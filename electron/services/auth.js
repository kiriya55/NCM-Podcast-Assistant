const fetch = require('node-fetch')
const QRCode = require('qrcode')
const { BASE_URL, UA, NeteaseService } = require('./neteaseService')

class AuthService extends NeteaseService {
  constructor(cookieStore) {
    super(cookieStore)
  }

  // 初始化会话：先访问网易云首页获取初始 cookie（模拟真实浏览器行为）
  async initSession() {
    try {
      const res = await fetch(BASE_URL, {
        method: 'GET',
        headers: {
          'User-Agent': UA,
          'Referer': 'https://music.163.com/',
        },
      })
      this._parseCookies(res.headers.raw()['set-cookie'])
      // 设置基本 cookie
      if (!this.cookies['os']) this.cookies['os'] = 'pc'
      if (!this.cookies['appver']) this.cookies['appver'] = '2.10.15'
      if (!this.cookies['channel']) this.cookies['channel'] = 'netease'
      this.cookieStore.setCookies(this.cookies)
      console.log('[Auth] Session initialized, cookies:', Object.keys(this.cookies).join(', '))
    } catch (err) {
      console.error('[Auth] initSession failed:', err.message)
      // 即使失败也设置基本 cookie
      this.cookies['os'] = 'pc'
      this.cookies['appver'] = '2.10.15'
      this.cookies['channel'] = 'netease'
      this.cookieStore.setCookies(this.cookies)
    }
  }

  // 获取二维码 key
  async getQRKey() {
    // 确保会话已初始化（获取初始 cookie）
    await this.initSession()

    const data = await this._postWeapi('/weapi/login/qrcode/unikey', {
      type: 3,
    })

    if (data.code !== 200 || !data.unikey) {
      throw new Error('获取二维码key失败: ' + JSON.stringify(data))
    }
    return { unikey: data.unikey }
  }

  // 生成二维码图片
  async getQRCode(key) {
    const qrText = `https://music.163.com/login?codekey=${key}`

    try {
      const qrDataUrl = await QRCode.toDataURL(qrText, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      })
      return { qrDataUrl, qrText }
    } catch (err) {
      throw new Error('生成二维码失败: ' + err.message)
    }
  }

  // 轮询检查扫码状态
  // 关键：这里只负责保存 cookie 并返回成功状态，不做额外网络请求
  async checkQRLogin(key) {
    console.log('[Auth] checkQRLogin called, key:', key)
    const data = await this._postWeapi('/weapi/login/qrcode/client/login', {
      key: key,
      type: 3,
    })
    console.log('[Auth] checkQRLogin response:', JSON.stringify(data))

    if (data.code === 803) {
      console.log('[Auth] Login success! Extracting cookies...')
      // 登录成功，从 set-cookie 中提取 cookies
      if (data.cookie) {
        console.log('[Auth] Got cookie from response:', data.cookie.slice(0, 100))
        this._parseCookieString(data.cookie)
      }
      this.cookies['MUSIC_U'] = this.cookies['MUSIC_U'] || ''
      this.cookies['__csrf'] = this.cookies['__csrf'] || ''
      this.cookieStore.setCookies(this.cookies)
      this.cookieStore.setToken(this.cookies['MUSIC_U'] || '')
      // 同步到 Electron session（让 net.fetch 也能用）
      await this._syncCookiesToSession()
      console.log('[Auth] Cookies saved. MUSIC_U:', this.cookies['MUSIC_U'] ? 'exists' : 'MISSING')

      return { success: true, code: 803, message: '登录成功' }
    }

    const statusMap = {
      800: '二维码已过期',
      801: '等待扫码',
      802: '已扫码，请确认',
    }

    console.log('[Auth] QR status:', data.code, statusMap[data.code] || 'unknown')
    return {
      success: false,
      code: data.code,
      message: statusMap[data.code] || data.message || '未知状态',
    }
  }

  // 获取用户信息（独立调用，带超时）
  async getUserInfo() {
    console.log('[Auth] getUserInfo called, cookies:', Object.keys(this.cookies).join(', '))

    const endpoints = [
      { path: '/weapi/w/nuser/account/get', extract: (d) => ({ userId: String(d.account?.id || ''), nickname: d.profile?.nickname || '', avatarUrl: d.profile?.avatarUrl || '' }) },
      { path: '/api/w/user/info', extract: (d) => ({ userId: String(d.profile?.userId || ''), nickname: d.profile?.nickname || '', avatarUrl: d.profile?.avatarUrl || '' }) },
      { path: '/api/v1/user/info', extract: (d) => { const p = d.profile || {}; const a = d.account || {}; return { userId: String(p.userId || a.id || ''), nickname: p.nickname || '', avatarUrl: p.avatarUrl || '' } } },
    ]

    for (const { path, extract } of endpoints) {
      try {
        const data = await this._postWeapi(path, { timestamp: Date.now() }, 10000)
        if (data.code === 200 && (data.account || data.profile)) {
          const info = extract(data)
          if (info.userId) {
            this.cookieStore.setUserId(info.userId)
            this.cookieStore.setNickname(info.nickname)
            return info
          }
        }
      } catch (e) {
        // 继续尝试下一个端点
      }
    }

    if (this.cookies['MUSIC_U']) {
      return { userId: '', nickname: '', avatarUrl: '' }
    }

    throw new Error('获取用户信息失败，请重新登录')
  }

  // 检查登录状态
  async checkLoginStatus() {
    const token = this.cookieStore.getToken()
    if (!token) return false

    try {
      await this.getUserInfo()
      return true
    } catch {
      return false
    }
  }

  // 发送手机验证码
  async sendCaptcha(phone) {
    const data = await this._postWeapi('/api/sms/captcha/sent', {
      cellphone: phone,
      ctcode: '86',
    })

    if (data.code !== 200) {
      throw new Error('发送验证码失败: ' + (data.message || JSON.stringify(data)))
    }
    return { success: true, message: '验证码已发送' }
  }

  // 手机验证码登录
  async verifyCaptcha(phone, captcha) {
    const data = await this._postWeapi('/weapi/w/login/cellphone', {
      phone: phone,
      captcha: captcha,
      countrycode: '86',
      type: '1',
      https: 'true',
      remember: 'true',
    })

    if (data.code === 200 && data.loginType === 1) {
      if (data.cookie) {
        this._parseCookieString(data.cookie)
      }
      this.cookies['MUSIC_U'] = this.cookies['MUSIC_U'] || ''
      this.cookies['__csrf'] = this.cookies['__csrf'] || ''
      this.cookieStore.setCookies(this.cookies)
      this.cookieStore.setToken(this.cookies['MUSIC_U'] || '')
      this.cookieStore.setUserId(String(data.account?.id || ''))
      this.cookieStore.setNickname(data.profile?.nickname || '')
      return { success: true, nickname: data.profile?.nickname || '' }
    }

    throw new Error('登录失败: ' + (data.message || JSON.stringify(data)))
  }

  logout() {
    this.cookies = {}
    this.cookieStore.clear()
  }
}

module.exports = AuthService
