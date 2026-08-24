'use strict'

const { CliError } = require('./errors')

const BOOLEAN_OPTIONS = new Set(['help', 'json', 'jsonl', 'yes'])
const ARRAY_OPTIONS = new Set(['episode-id', 'file'])

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())
}

function parseArgv(argv = []) {
  const commandPath = []
  const options = {}
  const positionals = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (token === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }

    if (!token.startsWith('-')) {
      commandPath.push(token)
      continue
    }

    if (!token.startsWith('--')) {
      throw new CliError('INVALID_INPUT', `Only long options are supported: ${token}`)
    }

    const optionText = token.slice(2)
    const equalsIndex = optionText.indexOf('=')
    const rawName = equalsIndex >= 0 ? optionText.slice(0, equalsIndex) : optionText
    let value = equalsIndex >= 0 ? optionText.slice(equalsIndex + 1) : undefined

    if (!rawName) {
      throw new CliError('INVALID_INPUT', 'Option name cannot be empty')
    }

    const name = camelCase(rawName)
    if (BOOLEAN_OPTIONS.has(rawName)) {
      if (value !== undefined) {
        throw new CliError('INVALID_INPUT', `Boolean option --${rawName} does not accept a value`)
      }
      options[name] = true
      continue
    }

    if (value === undefined) {
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new CliError('INVALID_INPUT', `Option --${rawName} requires a value`)
      }
      value = next
      index += 1
    }

    if (ARRAY_OPTIONS.has(rawName)) {
      if (!options[name]) options[name] = []
      options[name].push(value)
    } else {
      options[name] = value
    }
  }

  if (options.json && options.jsonl) {
    throw new CliError('INVALID_INPUT', '--json and --jsonl are mutually exclusive')
  }

  return {
    mode: options.jsonl ? 'jsonl' : options.json ? 'json' : 'human',
    commandPath,
    options,
    positionals,
  }
}

module.exports = { parseArgv }
