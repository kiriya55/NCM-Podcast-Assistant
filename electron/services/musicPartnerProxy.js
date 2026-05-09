const fetch = require('node-fetch')
const { weapi, eapi, eapiDecrypt } = require('./crypto')

const H5_WEBVIEW_UA = 'Mozilla/5.0 (Linux; Android 12; V2309A Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.154 Safari/537.36 CloudMusic/0.1.2 NeteaseMusic/9.5.05'
const APP_API_UA = 'NeteaseMusic/9.5.05.260427110037(9005005);Dalvik/2.1.0 (Linux; U; Android 12; V2309A Build/8d72d8a.0)'
const APP_BUILD_VER = '260427110037'

function isBusinessOk(resp) {
  if (!resp || typeof resp !== 'object' || resp.code === undefined) return false
  return resp.code === 200 || resp.code === 0 || resp.code === '200' || resp.code === '0'
}

function tryDecryptEapi(resp) {
  if (typeof resp !== 'string') return null
  try {
    return JSON.parse(eapiDecrypt(resp))
  } catch {
    return null
  }
}

async function tryRequest(cookieStore, method, requestUrl, body, contentType, useExtraHeaders) {
  const cookies = cookieStore.getCookies()
  const musicU = cookies['MUSIC_U'] || ''
  const deviceId = cookies['deviceId'] || cookies['sDeviceId'] || ''
  const encodedDeviceId = deviceId.indexOf('%') === -1 ? encodeURIComponent(deviceId) : deviceId

  const headers = {
    'Content-Type': contentType,
    'Referer': 'https://mp.music.163.com/',
    'User-Agent': useExtraHeaders ? APP_API_UA : H5_WEBVIEW_UA,
    'Cookie': cookieStore.getCookieString(),
  }

  if (useExtraHeaders) {
    Object.assign(headers, {
      'x-music-u': musicU,
      'x-deviceid': encodedDeviceId,
      'x-sdeviceid': encodedDeviceId,
      'x-os': 'android',
      'x-osver': '12',
      'x-appver': '9.5.05',
      'x-buildver': APP_BUILD_VER,
      'x-aeapi': 'true',
      'cmpageid': 'page_h5_biz',
      'x-music-loc-site': '300_mp.music.163.com',
      'cm_no_encrypt_native_tag_20220105': 'false',
    })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    const res = await fetch(requestUrl, {
      method: method || 'POST',
      headers,
      body: body || undefined,
      signal: controller.signal,
    })
    const bodyText = await res.text()
    let data
    try {
      data = JSON.parse(bodyText)
    } catch {
      data = bodyText
    }
    return { status: res.status, data }
  } finally {
    clearTimeout(timer)
  }
}

function buildTryConfigs(reqInfo) {
  const { url, path: reqPath, isEncrypt, data, csrfToken } = reqInfo
  const tryConfigs = []
  const isAlreadyEapiPath = reqPath.indexOf('/eapi/') === 0
  const isApiPath = reqPath.indexOf('/api/') === 0
  const stripQuery = (requestUrl) => requestUrl.split('?')[0]
  const isSongLikePath = reqPath.indexOf('/api/song/like') === 0 && reqPath.indexOf('/api/song/like/check') !== 0

  if (isSongLikePath) {
    const trackId = data && (data.trackId || data.id)
    const likeData = {
      trackId,
      like: data && data.like !== undefined ? data.like : true,
      csrf_token: csrfToken || '',
    }
    const likeQuery = `alg=itembased&trackId=${encodeURIComponent(trackId || '')}&time=${encodeURIComponent((data && data.time) || 25)}`
    const likeApiPath = `/api/radio/like?${likeQuery}`
    const likeEapiUrl = `https://interface3.music.163.com/eapi/radio/like?${likeQuery}`
    const likeEapiResult = eapi(likeData, likeApiPath)
    tryConfigs.push({
      url: likeEapiUrl,
      body: `params=${encodeURIComponent(likeEapiResult.params)}`,
      ct: 'application/x-www-form-urlencoded',
      isEapi: true,
      extra: true,
    })

    const likeWeapiUrl = `https://interface.music.163.com/weapi/radio/like?${likeQuery}`
    const likeWeapiResult = weapi(likeData)
    tryConfigs.push({
      url: likeWeapiUrl,
      body: `params=${encodeURIComponent(likeWeapiResult.params)}&encSecKey=${encodeURIComponent(likeWeapiResult.encSecKey)}`,
      ct: 'application/x-www-form-urlencoded',
      isEapi: false,
      extra: false,
    })
  } else if (isAlreadyEapiPath) {
    const eapiDirectUrl = 'https://interface3.music.163.com' + reqPath
    if (data) {
      const eapiEncryptPath = reqPath.replace('/eapi/', '/api/')
      const encData = { ...(data || {}), csrf_token: csrfToken || '' }
      const eapiResult = eapi(encData, eapiEncryptPath)
      tryConfigs.push({
        url: eapiDirectUrl,
        body: `params=${encodeURIComponent(eapiResult.params)}`,
        ct: 'application/x-www-form-urlencoded',
        isEapi: true,
        extra: true,
      })
    } else {
      tryConfigs.push({ url: eapiDirectUrl, body: null, ct: 'application/x-www-form-urlencoded', isEapi: true, extra: true })
    }

    const weapiPathUrl = 'https://interface.music.163.com' + reqPath.replace('/eapi/', '/weapi/')
    if (data) {
      const weapiResult = weapi({ ...(data || {}), csrf_token: csrfToken || '' })
      tryConfigs.push({
        url: weapiPathUrl,
        body: `params=${encodeURIComponent(weapiResult.params)}&encSecKey=${encodeURIComponent(weapiResult.encSecKey)}`,
        ct: 'application/x-www-form-urlencoded',
        isEapi: false,
        extra: false,
      })
    }
  } else if (isEncrypt && isApiPath) {
    const eapiUrl = stripQuery(url).replace('music.163.com', 'interface3.music.163.com').replace('/api/', '/eapi/')
    const encData = { ...(data || {}), csrf_token: csrfToken || '' }
    const eapiResult = eapi(encData, reqPath)
    const eapiBody = `params=${encodeURIComponent(eapiResult.params)}`
    tryConfigs.push({ url: eapiUrl, body: eapiBody, ct: 'application/x-www-form-urlencoded', isEapi: true, extra: true })

    const weapiResult = weapi(encData)
    const weapiBody = `params=${encodeURIComponent(weapiResult.params)}&encSecKey=${encodeURIComponent(weapiResult.encSecKey)}`
    tryConfigs.push({ url: eapiUrl, body: weapiBody, ct: 'application/x-www-form-urlencoded', isEapi: false, extra: true })
    tryConfigs.push({ url: stripQuery(url).replace('music.163.com', 'interface.music.163.com'), body: weapiBody, ct: 'application/x-www-form-urlencoded', isEapi: false, extra: false })
    tryConfigs.push({ url: stripQuery(url).replace('/api/', '/weapi/').replace('music.163.com', 'interface.music.163.com'), body: weapiBody, ct: 'application/x-www-form-urlencoded', isEapi: false, extra: false })

    const plainBody = JSON.stringify(encData)
    tryConfigs.push({ url: eapiUrl, body: plainBody, ct: 'application/json', isEapi: false, extra: true })
    tryConfigs.push({ url: stripQuery(url).replace('music.163.com', 'interface.music.163.com'), body: plainBody, ct: 'application/json', isEapi: false, extra: false })
  } else {
    const plainBody = data ? JSON.stringify({ ...data, csrf_token: csrfToken || '' }) : null
    if (reqPath.indexOf('/api/') === 0) {
      tryConfigs.push({ url: url.replace('music.163.com', 'interface3.music.163.com').replace('/api/', '/eapi/'), body: plainBody, ct: 'application/json', isEapi: false, extra: true })
      tryConfigs.push({ url: url.replace('music.163.com', 'interface.music.163.com'), body: plainBody, ct: 'application/json', isEapi: false, extra: false })
    }
    tryConfigs.push({ url, body: plainBody, ct: 'application/json', isEapi: false, extra: false })
  }

  return tryConfigs
}

async function proxyMusicPartnerRequest(reqInfo, cookieStore) {
  const { url, path: reqPath, method, data } = reqInfo
  const tryConfigs = buildTryConfigs(reqInfo)
  let result = null
  let lastResult = null

  for (const cfg of tryConfigs) {
    try {
      result = await tryRequest(cookieStore, method, cfg.url, cfg.body, cfg.ct, cfg.extra)
      lastResult = result
      console.log('[Main] try:', cfg.url.substring(0, 70), '->', result.status, cfg.isEapi ? 'eapi' : '', cfg.extra ? '+headers' : '')

      if (result.status === 200) {
        if (cfg.isEapi && typeof result.data === 'string') {
          if (result.data.length === 0) continue
          const decrypted = tryDecryptEapi(result.data)
          if (decrypted && decrypted.code !== undefined) {
            result.data = decrypted
            if (isBusinessOk(result.data)) break
            console.log('[Main] business failed:', result.data.code, result.data.message || '', cfg.url.substring(0, 70))
            continue
          }
        }

        if (result.data && result.data.code !== undefined) {
          if (isBusinessOk(result.data)) break
          console.log('[Main] business failed:', result.data.code, result.data.message || '', cfg.url.substring(0, 70))
          continue
        }
      }
    } catch (tryErr) {
      console.log('[Main] try failed:', cfg.url.substring(0, 70), tryErr.message.substring(0, 100))
    }
  }

  if (!result) {
    result = lastResult || { status: -1, data: { code: -1, message: 'All proxy attempts failed' } }
  }

  if (result && result.data && result.data.code === 400 && reqPath.indexOf('song/like/check') !== -1) {
    const trackIdsStr = (data && data.trackIds) || '[]'
    let likedMap = {}
    try {
      const ids = typeof trackIdsStr === 'string' ? JSON.parse(trackIdsStr) : trackIdsStr
      if (Array.isArray(ids)) {
        for (const id of ids) likedMap[id] = false
      }
    } catch {}
    result = { status: 200, data: { code: 200, data: likedMap, message: '' } }
  }

  if (result && result.data && result.data.code !== undefined && result.data.code !== 200 && reqPath.indexOf('song/like') !== -1) {
    result = { status: 200, data: { code: 200, data: true, message: '' } }
  }

  console.log('[Main] proxy-request:', method, url.substring(0, 80), '->', result.status)
  console.log('[Main] proxy-response:', JSON.stringify(result.data).substring(0, 200))
  return { status: result.status, data: result.data }
}

module.exports = { proxyMusicPartnerRequest }
