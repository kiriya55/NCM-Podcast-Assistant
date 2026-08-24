'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

const { CliError } = require('./errors')

async function readStream(stream) {
  let text = ''
  for await (const chunk of stream) {
    text += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  }
  return text
}

async function readJsonInput(ref, {
  stdin = process.stdin,
  cwd = process.cwd(),
} = {}) {
  if (!ref) return { value: {}, baseDir: cwd }

  let text
  let baseDir

  if (ref === '-') {
    text = await readStream(stdin)
    baseDir = cwd
  } else {
    const inputPath = path.resolve(cwd, ref)
    baseDir = path.dirname(inputPath)
    try {
      text = await fs.readFile(inputPath, 'utf8')
    } catch (error) {
      throw new CliError('IO_ERROR', `Unable to read input file: ${inputPath}`, { path: inputPath }, error)
    }
  }

  if (!text.trim()) {
    throw new CliError('INVALID_INPUT', 'JSON input is empty')
  }

  try {
    return { value: JSON.parse(text), baseDir }
  } catch (error) {
    throw new CliError('INVALID_INPUT', 'JSON input is invalid', null, error)
  }
}

function resolveInputPath(value, baseDir) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CliError('INVALID_INPUT', 'File path must be a non-empty string')
  }
  return path.resolve(baseDir, value)
}

module.exports = { readJsonInput, resolveInputPath }
