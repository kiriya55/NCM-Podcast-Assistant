'use strict'

const { CliError } = require('../errors')

const TEMPLATE_FIELDS = new Set(['nameTemplate', 'introTemplate'])

function createLlmCommands({ llmService }) {
  return {
    'llm parse': async ({ input = {} }) => {
      if (typeof input.text !== 'string' || !input.text.trim()) {
        throw new CliError('INVALID_INPUT', 'text must be a non-empty string')
      }

      if (input.template !== undefined) {
        if (!input.template || typeof input.template !== 'object' || Array.isArray(input.template)) {
          throw new CliError('INVALID_INPUT', 'template must be an object')
        }
        const unknown = Object.keys(input.template).filter(key => !TEMPLATE_FIELDS.has(key))
        if (unknown.length > 0) {
          throw new CliError('INVALID_INPUT', `Unknown template fields: ${unknown.join(', ')}`, { fields: unknown })
        }
      }

      return llmService.parseSongInfo(input.text, input.template)
    },
  }
}

module.exports = { createLlmCommands }
