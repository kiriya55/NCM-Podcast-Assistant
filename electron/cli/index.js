'use strict'

const { parseArgv } = require('./args')
const { CliError, exitCodeFor } = require('./errors')
const { readJsonInput } = require('./input')
const { createOutput } = require('./output')
const { createRegistry } = require('./registry')
const { createCliServices, resolveDataDir } = require('./storage')

function requestedMode(argv) {
  if (argv.includes('--jsonl')) return 'jsonl'
  if (argv.includes('--json')) return 'json'
  return 'human'
}

function normalizeError(error, signal) {
  if (error instanceof CliError) return error
  if (signal?.aborted) return new CliError('CANCELLED', 'Operation was cancelled', null, error)
  return new CliError('REMOTE_ERROR', error?.message || 'Unexpected failure', null, error)
}

function addSecrets(target, services, input, env) {
  for (const name of ['NCM_MP_PASSWORD', 'VITE_MP_PASSWORD', 'OPENAI_API_KEY']) {
    if (env[name]) target.push(String(env[name]))
  }

  const cookies = services?.cookieStore?.getCookies?.() || {}
  target.push(...Object.values(cookies).filter(value => typeof value === 'string' && value))

  const storedApiKey = services?.settingsStore?.get?.('openaiApiKey')
  if (storedApiKey) target.push(String(storedApiKey))

  if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input)) {
      if (/^(openaiApiKey|password|captcha|smsCode|code|token)$/i.test(key) && typeof value === 'string' && value) {
        target.push(value)
      } else if (value && typeof value === 'object') {
        addSecrets(target, null, value, {})
      }
    }
  }
}

async function withRedirectedConsole(output, operation) {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  }
  console.log = (...values) => output.diagnostic(...values)
  console.warn = (...values) => output.diagnostic(...values)
  console.error = (...values) => output.diagnostic(...values)
  try {
    return await operation()
  } finally {
    console.log = original.log
    console.warn = original.warn
    console.error = original.error
  }
}

async function runCli(argv, io = {}, dependencies = {}) {
  const stdin = io.stdin || process.stdin
  const stdout = io.stdout || process.stdout
  const stderr = io.stderr || process.stderr
  const env = io.env || process.env
  const cwd = io.cwd || process.cwd()
  const signal = io.signal || new AbortController().signal
  const secrets = []

  let invocation
  try {
    invocation = parseArgv(argv)
  } catch (error) {
    const output = createOutput({ mode: requestedMode(argv), stdout, stderr, secrets, command: '' })
    const normalized = normalizeError(error, signal)
    output.failure(normalized)
    return exitCodeFor(normalized)
  }

  const command = invocation.commandPath.join(' ')
  const output = createOutput({ mode: invocation.mode, stdout, stderr, secrets, command })

  try {
    let services = dependencies.services || null
    let registry = createRegistry({ services: services || {}, commandDependencies: dependencies.commandDependencies })

    if (invocation.options.help || invocation.commandPath.length === 0) {
      output.success(registry.help(invocation.commandPath))
      return 0
    }

    registry.validate(command, invocation.options, invocation.positionals)

    if (!services) {
      services = createCliServices({ dataDir: resolveDataDir({ env }) })
      registry = createRegistry({ services, commandDependencies: dependencies.commandDependencies })
    }
    const definition = registry.get(command)

    const { value: input, baseDir: inputBaseDir } = await readJsonInput(invocation.options.input, { stdin, cwd })
    addSecrets(secrets, services, input, env)

    const result = await withRedirectedConsole(output, () => definition.handler({
      env,
      input,
      inputBaseDir,
      mode: invocation.mode,
      options: invocation.options,
      output,
      signal,
    }))
    output.success(result)
    return 0
  } catch (error) {
    const normalized = normalizeError(error, signal)
    if (!output.terminalEventWritten) output.failure(normalized)
    return exitCodeFor(normalized)
  }
}

module.exports = { runCli }
