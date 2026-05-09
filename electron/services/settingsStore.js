const Store = require('electron-store')

const schema = {
  openaiApiKey: { type: 'string', default: '' },
  openaiBaseUrl: { type: 'string', default: 'https://api.openai.com/v1' },
  openaiModel: { type: 'string', default: 'gpt-4o' },
  nameTemplate: {
    type: 'string',
    default: '【{projectName}】{songTitle} - {artistName}'
  },
  introTemplate: {
    type: 'string',
    default: `原名：{originalTitle}
作词：{lyricist}
作曲：{composer}
编曲：{arranger}
歌：{artistName}`
  },
  systemPrompt: { type: 'string', default: '' },
}

class SettingsStore {
  constructor() {
    this.store = new Store({ name: 'settings', schema })
    this._keys = Object.keys(schema)
  }

  getAll() {
    const result = {}
    for (const key of this._keys) {
      result[key] = this.store.get(key)
    }
    return result
  }

  save(settings) {
    for (const key of this._keys) {
      if (settings[key] !== undefined) {
        this.store.set(key, settings[key])
      }
    }
  }

  get(key) {
    return this.store.get(key)
  }
}

module.exports = SettingsStore
