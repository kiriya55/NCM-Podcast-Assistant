'use strict'

const { CliError } = require('../errors')

const SETTING_KEYS = Object.freeze([
  'openaiApiKey',
  'openaiBaseUrl',
  'openaiModel',
  'nameTemplate',
  'introTemplate',
  'systemPrompt',
])

function createSettingsCommands({ settingsStore, llmService }) {
  return {
    'settings get': async () => {
      const { openaiApiKey, ...settings } = settingsStore.getAll()
      return { ...settings, hasOpenaiApiKey: Boolean(openaiApiKey) }
    },

    'settings set': async ({ input = {} }) => {
      const keys = Object.keys(input)
      if (keys.length === 0) {
        throw new CliError('INVALID_INPUT', 'At least one setting is required')
      }

      const unknown = keys.filter(key => !SETTING_KEYS.includes(key))
      if (unknown.length > 0) {
        throw new CliError('INVALID_INPUT', `Unknown setting fields: ${unknown.join(', ')}`, { fields: unknown })
      }

      const updates = Object.fromEntries(keys.map(key => [key, input[key]]))
      settingsStore.save(updates)
      llmService.updateConfig(updates)

      const hasOpenaiApiKey = Object.hasOwn(updates, 'openaiApiKey')
        ? Boolean(updates.openaiApiKey)
        : Boolean(settingsStore.get('openaiApiKey'))

      return { updated: keys, hasOpenaiApiKey }
    },
  }
}

module.exports = { createSettingsCommands, SETTING_KEYS }
