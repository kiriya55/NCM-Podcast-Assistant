const OpenAI = require('openai')
const { DEFAULT_SYSTEM_PROMPT } = require('./defaults')

class LLMService {
  constructor(settingsStore) {
    this.settingsStore = settingsStore
    this._initClient()
  }

  _initClient() {
    const apiKey = this.settingsStore.get('openaiApiKey')
    const baseURL = this.settingsStore.get('openaiBaseUrl') || 'https://api.openai.com/v1'
    if (apiKey) {
      this.client = new OpenAI({ apiKey, baseURL })
    } else {
      this.client = null
    }
  }

  updateConfig(settings) {
    if (settings.openaiApiKey) {
      const baseURL = settings.openaiBaseUrl || this.settingsStore.get('openaiBaseUrl') || 'https://api.openai.com/v1'
      this.client = new OpenAI({ apiKey: settings.openaiApiKey, baseURL })
    }
  }

  async parseSongInfo(text, template) {
    if (!this.client) {
      throw new Error('请先在设置中配置 OpenAI API Key')
    }

    const model = this.settingsStore.get('openaiModel') || 'gpt-4o'

    const systemPrompt = this.settingsStore.get('systemPrompt') || DEFAULT_SYSTEM_PROMPT

    const userPrompt = `请从以下文本中提取歌曲信息：

${text}`

    const response = await this.client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      throw new Error('LLM返回为空')
    }

    let parsed
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error('LLM返回格式错误: ' + content)
    }

    // 根据模板生成名称和介绍
    const name = this._formatTemplate(template?.nameTemplate || '【{projectName}】{songTitle} - {artistName}', parsed)
    const intro = this._formatIntroTemplate(template?.introTemplate, parsed)

    return {
      raw: parsed,
      name,
      description: intro,
    }
  }

  _formatTemplate(template, data) {
    let result = template
    for (const [key, value] of Object.entries(data)) {
      result = result.replaceAll(`{${key}}`, value || '')
    }
    // 清理多余的空格和标点
    result = result.replace(/\s+/g, ' ').trim()
    // 如果【】内容为空则去掉
    result = result.replace(/【】/g, '')
    // 如果 - 前后为空则清理
    result = result.replace(/\s*-\s*$/, '')
    return result
  }

  _formatIntroTemplate(template, data) {
    const defaultTemplate = template || `原名：{originalTitle}
作词：{lyricist}
作曲：{composer}
编曲：{arranger}
歌：{artistName}`

    const lines = defaultTemplate.split('\n')
    const result = []
    const processedKeys = new Set()

    // 合并逻辑：当作词、作曲、编曲有重复的人时，合并为一行
    const roleKeys = ['lyricist', 'composer', 'arranger']
    const roleLabels = { lyricist: '作词', composer: '作曲', arranger: '编曲' }
    const rolesWithValue = roleKeys.filter(k => data[k])

    const personRoles = {}
    for (const key of rolesWithValue) {
      const person = data[key]
      if (!personRoles[person]) personRoles[person] = []
      personRoles[person].push(key)
    }

    for (const line of lines) {
      const match = line.match(/^([^：]+)：\{(\w+)\}$/)
      if (match) {
        const [, label, key] = match
        if (processedKeys.has(key)) continue

        if (roleKeys.includes(key)) {
          const person = data[key]
          if (!person) continue
          const roles = personRoles[person]
          if (roles.length > 1) {
            const mergedLabel = roles.map(r => roleLabels[r]).join('/')
            result.push(`${mergedLabel}：${person}`)
            roles.forEach(r => processedKeys.add(r))
          } else {
            result.push(`${label}：${person}`)
            processedKeys.add(key)
          }
        } else if (key === 'artistName') {
          // "歌：" 行始终输出，cast 紧随其后
          const value = data[key] || ''
          result.push(`歌：${value}`)
          if (data.cast) {
            result.push(data.cast)
          }
        } else {
          const value = data[key] || ''
          if (value) result.push(`${label}：${value}`)
        }
      } else {
        let formatted = line
        for (const [key, value] of Object.entries(data)) {
          formatted = formatted.replaceAll(`{${key}}`, value || '')
        }
        if (formatted.includes('：') && !formatted.endsWith('：')) {
          result.push(formatted)
        } else if (!formatted.includes('：') && formatted.trim()) {
          result.push(formatted)
        }
      }
    }

    return result.join('\n')
  }
}

module.exports = LLMService
