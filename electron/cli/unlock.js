'use strict'

const crypto = require('node:crypto')
const nodeFs = require('node:fs')
const path = require('node:path')

const { CliError } = require('./errors')

const DEFAULT_ENV_FILE = path.resolve(__dirname, '..', '..', '.env')

function parseEnvValue(text, name) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match || match[1] !== name) continue

    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }
    return value
  }
  return ''
}

function readReferenceValue({ env, envFile, fs }) {
  if (typeof env.VITE_MP_PASSWORD === 'string' && env.VITE_MP_PASSWORD.length > 0) {
    return env.VITE_MP_PASSWORD
  }

  try {
    return parseEnvValue(fs.readFileSync(envFile, 'utf8'), 'VITE_MP_PASSWORD')
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw new CliError('IO_ERROR', 'Unable to read the project unlock configuration', null, error)
  }
}

function validateMusicPartnerUnlock({
  env = process.env,
  envFile = DEFAULT_ENV_FILE,
  fs = nodeFs,
} = {}) {
  const supplied = typeof env.NCM_MP_PASSWORD === 'string' ? env.NCM_MP_PASSWORD : ''
  const reference = readReferenceValue({ env, envFile, fs })
  let suppliedDigest = null
  let referenceDigest = null

  try {
    suppliedDigest = crypto.createHash('sha256').update(supplied, 'utf8').digest()
    referenceDigest = crypto.createHash('sha256').update(reference, 'utf8').digest()
    const matches = supplied.length > 0
      && reference.length > 0
      && crypto.timingSafeEqual(suppliedDigest, referenceDigest)
    if (!matches) throw new CliError('UNLOCK_FAILED', 'Music Partner unlock failed')
  } finally {
    suppliedDigest?.fill(0)
    referenceDigest?.fill(0)
  }
}

module.exports = {
  DEFAULT_ENV_FILE,
  parseEnvValue,
  validateMusicPartnerUnlock,
}
