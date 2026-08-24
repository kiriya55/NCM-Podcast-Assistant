'use strict'

const SECRET_KEY = /^(cookie|stringCookie|musicU|csrf|token|apiKey|openaiApiKey|password|captcha|smsCode|authorization)$/i

function redact(value, secrets = []) {
  if (Array.isArray(value)) return value.map(item => redact(item, secrets))

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : redact(item, secrets),
    ]))
  }

  if (typeof value !== 'string') return value

  return secrets
    .filter(secret => typeof secret === 'string' && secret.length > 0)
    .reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value)
}

function createOutput({
  mode = 'human',
  stdout = process.stdout,
  stderr = process.stderr,
  secrets = [],
  command = '',
} = {}) {
  let terminalEventWritten = false
  const meta = Object.freeze({ command, version: 1 })

  function writeLine(stream, value) {
    stream.write(`${value}\n`)
  }

  function ensureOpen() {
    if (terminalEventWritten) {
      throw new Error('A terminal event has already been emitted')
    }
  }

  function success(data) {
    ensureOpen()
    terminalEventWritten = true
    const safeData = redact(data, secrets)

    if (mode === 'jsonl') {
      writeLine(stdout, JSON.stringify({ event: 'result', ok: true, data: safeData, meta }))
    } else if (mode === 'json') {
      writeLine(stdout, JSON.stringify({ ok: true, data: safeData, meta }))
    } else if (typeof safeData === 'string') {
      writeLine(stdout, safeData)
    } else if (safeData !== undefined) {
      writeLine(stdout, JSON.stringify(safeData, null, 2))
    }
  }

  function failure(error) {
    ensureOpen()
    terminalEventWritten = true
    const safeError = redact({
      code: error?.code || 'REMOTE_ERROR',
      message: error?.message || 'Unknown error',
      details: error?.details ?? null,
    }, secrets)

    if (mode === 'jsonl') {
      writeLine(stdout, JSON.stringify({ event: 'error', ok: false, error: safeError, meta }))
    } else if (mode === 'json') {
      writeLine(stdout, JSON.stringify({ ok: false, error: safeError, meta }))
    } else {
      writeLine(stderr, `${safeError.code}: ${safeError.message}`)
    }
  }

  function event(name, data) {
    ensureOpen()
    const safeData = redact(data, secrets)

    if (mode === 'jsonl') {
      writeLine(stdout, JSON.stringify({ event: name, data: safeData, meta }))
    } else if (mode === 'human' && name === 'start' && safeData?.qrTerminal) {
      writeLine(stdout, `QR URL: ${safeData.qrUrl}`)
      stdout.write(safeData.qrTerminal.endsWith('\n') ? safeData.qrTerminal : `${safeData.qrTerminal}\n`)
    } else if (mode === 'human') {
      writeLine(stdout, `[${name}] ${typeof safeData === 'string' ? safeData : JSON.stringify(safeData)}`)
    } else {
      writeLine(stderr, `[${name}] ${typeof safeData === 'string' ? safeData : JSON.stringify(safeData)}`)
    }
  }

  function diagnostic(...values) {
    const text = values.map(value => {
      const safeValue = redact(value, secrets)
      return typeof safeValue === 'string' ? safeValue : JSON.stringify(safeValue)
    }).join(' ')
    writeLine(stderr, text)
  }

  return {
    diagnostic,
    event,
    failure,
    get terminalEventWritten() { return terminalEventWritten },
    success,
  }
}

module.exports = { createOutput, redact }
