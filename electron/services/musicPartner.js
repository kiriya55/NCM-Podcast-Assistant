/**
 * 音乐合伙人 API 服务
 * 基于 HAR 抓包分析，使用 eapi 加密方案
 */
const fetch = require('node-fetch')
const { eapi } = require('./crypto')

const API_BASE = 'https://interface3.music.163.com'
const USER_API = 'https://music.163.com/api/nuser/account/get'

class MusicPartnerService {
  constructor(cookieStore) {
    this.cookieStore = cookieStore
  }

  _getHeaders(extra = {}) {
    return {
      'User-Agent': 'NeteaseMusic/9.5.05.260427110037(9005005);Dalvik/2.1.0 (Linux; U; Android 12; V2309A Build/8d72d8a.0)',
      'Cookie': this.cookieStore.getCookieString(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-aeapi': 'true',
      ...extra,
    }
  }

  async _get(url) {
    const res = await fetch(url, {
      method: 'GET',
      headers: this._getHeaders(),
      timeout: 15000,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    return res.json()
  }

  async _post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: this._getHeaders(),
      body,
      timeout: 15000,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    return res.json()
  }

  _postEncrypted(path, data) {
    const csrf = this.cookieStore.getCookies().__csrf || ''
    data.csrf_token = csrf
    const encrypted = eapi(data, path)
    const body = `params=${encodeURIComponent(encrypted.params)}`
    return this._post(`${API_BASE}${path}?csrf_token=${csrf}`, body)
  }

  async verifyUser() {
    try {
      const cookieStr = this.cookieStore.getCookieString()
      if (!cookieStr || cookieStr.length < 10) {
        return { success: false, message: '未找到登录Cookie，请先登录' }
      }
      const res = await this._get(USER_API)
      if (res.profile) {
        return { success: true, nickname: res.profile.nickname, userId: res.profile.userId }
      }
      return { success: false, message: 'Cookie 已失效，请重新登录' }
    } catch (err) {
      return { success: false, message: `验证失败: ${err.message}` }
    }
  }

  async getDailyTasks() {
    const path = '/eapi/music/partner/daily/task/get'
    const res = await this._postEncrypted(path, {})
    if (res.code !== 200) {
      throw new Error(res.message || res.msg || '获取每日任务失败')
    }
    return res.data
  }

  async getExtraTasks() {
    const path = '/eapi/music/partner/extra/wait/evaluate/work/list'
    const res = await this._postEncrypted(path, {})
    if (res.code !== 200) {
      throw new Error(res.message || res.msg || '获取额外任务失败')
    }
    return res.data
  }

  async submitScore(taskId, work, score, isExtra = false, comment = '', share = true) {
    const tag = `${score}-A-1`
    const data = {
      taskId,
      workId: work.id,
      score: String(score),
      tags: tag,
      customTags: '%5B%5D',
      comment: comment || '',
      syncYunCircle: String(share),
      source: 'mp-music-partner',
    }
    if (isExtra) {
      data.extraResource = 'true'
    }

    const path = '/eapi/music/partner/work/evaluate'
    const res = await this._postEncrypted(path, data)

    if (res.code === 200) {
      const todayRemain = res.data && res.data.todayRemainCommentScore
      return { success: true, todayRemainCommentScore: todayRemain }
    }

    const errorMsg = res.message || res.msg || '未知错误'
    if (res.code === 405 && errorMsg.includes('资源状态异常')) {
      return { success: false, skipped: true, message: '资源状态异常，已跳过' }
    }
    throw new Error(`评分失败: ${errorMsg} (${res.code})`)
  }

  async checkText(content) {
    const path = '/eapi/music/partner/custom/content/antispam'
    const res = await this._postEncrypted(path, { content })
    if (res.code === 200) {
      return { success: true, data: res.data }
    }
    return { success: false, message: res.message || res.msg || '内容审核失败' }
  }

  async reportListen(work) {
    const data = {
      workId: work.id,
      resourceId: work.resourceId || '',
      bizResourceId: '',
      interactType: 'PLAY_END',
    }
    const path = '/eapi/partner/resource/interact/report'
    const res = await this._postEncrypted(path, data)
    if (res.code !== 200) {
      throw new Error(`上报听歌失败: ${res.message || res.msg}`)
    }
    return { success: true }
  }

  _getRandomDelay(min = 3, max = 6) {
    return (Math.random() * (max - min) + min) * 1000
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async runAllTasks(scoreStrategy = 3, progressCallback = null) {
    const results = {
      daily: { total: 0, completed: 0, skipped: 0, failed: 0, items: [] },
      extra: { total: 0, completed: 0, skipped: 0, failed: 0, items: [] },
    }

    // 验证用户
    const user = await this.verifyUser()
    if (!user.success) {
      throw new Error(user.message)
    }

    // === 每日基础任务 ===
    if (progressCallback) progressCallback({ stage: 'daily', message: '正在获取每日任务...' })
    const taskData = await this.getDailyTasks()
    const taskId = taskData.id

    const uncompletedWorks = (taskData.works || []).filter(t => !t.completed)
    const alreadyCompleted = (taskData.works || []).filter(t => t.completed)
    results.daily.total = taskData.count || taskData.works?.length || 0
    results.daily.completed = alreadyCompleted.length

    for (const task of alreadyCompleted) {
      results.daily.items.push({
        name: task.work.name,
        author: task.work.authorName,
        status: 'already_done',
        score: task.score,
      })
    }

    for (let i = 0; i < uncompletedWorks.length; i++) {
      const task = uncompletedWorks[i]
      const work = task.work
      if (progressCallback) {
        progressCallback({
          stage: 'daily',
          message: `评分中: ${work.name} - ${work.authorName}`,
          current: i + 1,
          total: uncompletedWorks.length,
        })
      }

      try {
        const score = this._calcScore(work, scoreStrategy)
        const submitResult = await this.submitScore(taskId, work, score, false)
        results.daily.completed++
        results.daily.items.push({
          name: work.name,
          author: work.authorName,
          status: 'done',
          score,
          todayRemainCommentScore: submitResult.todayRemainCommentScore,
        })
      } catch (err) {
        if (err.message.includes('资源状态异常')) {
          results.daily.skipped++
          results.daily.items.push({
            name: work.name,
            author: work.authorName,
            status: 'skipped',
            message: '资源状态异常',
          })
        } else {
          results.daily.failed++
          results.daily.items.push({
            name: work.name,
            author: work.authorName,
            status: 'failed',
            message: err.message,
          })
        }
      }

      if (i < uncompletedWorks.length - 1) {
        await this._sleep(this._getRandomDelay())
      }
    }

    // === 额外评分任务 ===
    if (progressCallback) progressCallback({ stage: 'extra', message: '正在获取额外任务...' })

    try {
      const extraTasks = await this.getExtraTasks()
      const uncompletedExtra = extraTasks.filter(t => !t.completed)
      const completedExtra = extraTasks.filter(t => t.completed)
      results.extra.total = 7
      results.extra.completed = completedExtra.length

      for (const task of completedExtra) {
        results.extra.items.push({
          name: task.work.name,
          author: task.work.authorName,
          status: 'already_done',
        })
      }

      const needCount = results.extra.total - results.extra.completed
      const tasksToDo = uncompletedExtra.slice(0, needCount)

      for (let i = 0; i < tasksToDo.length; i++) {
        const task = tasksToDo[i]
        const work = task.work
        if (progressCallback) {
          progressCallback({
            stage: 'extra',
            message: `额外评分: ${work.name} - ${work.authorName}`,
            current: i + 1,
            total: tasksToDo.length,
          })
        }

        try {
          await this.reportListen(work)
          await this._sleep(this._getRandomDelay(1, 3))

          const score = this._calcScore(work, scoreStrategy)
          const submitResult = await this.submitScore(taskId, work, score, true)
          results.extra.completed++
          results.extra.items.push({
            name: work.name,
            author: work.authorName,
            status: 'done',
            score,
            todayRemainCommentScore: submitResult.todayRemainCommentScore,
          })
        } catch (err) {
          results.extra.failed++
          results.extra.items.push({
            name: work.name,
            author: work.authorName,
            status: 'failed',
            message: err.message,
          })
        }

        if (i < tasksToDo.length - 1) {
          await this._sleep(this._getRandomDelay())
        }
      }
    } catch (err) {
      if (progressCallback) progressCallback({ stage: 'extra', message: `额外任务获取失败: ${err.message}` })
    }

    return { success: true, user, results }
  }

  _calcScore(work, strategy) {
    const hasEnglish = /[a-zA-Z]/.test(work.name + work.authorName)
    switch (strategy) {
      case 1: return hasEnglish ? 2 : 1
      case 2: return hasEnglish ? 3 : 2
      case 3: return hasEnglish ? 4 : 3
      case 4: return 4
      default: return hasEnglish ? 4 : 3
    }
  }
}

module.exports = MusicPartnerService
