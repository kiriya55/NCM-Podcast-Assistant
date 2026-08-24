'use strict'

const EXIT_CODES = Object.freeze({
  INVALID_INPUT: 2,
  CONFIRMATION_REQUIRED: 2,
  AUTH_REQUIRED: 3,
  UNLOCK_FAILED: 3,
  IO_ERROR: 4,
  REMOTE_ERROR: 4,
  PARTIAL_FAILURE: 5,
  TIMEOUT: 124,
  CANCELLED: 130,
})

class CliError extends Error {
  constructor(code, message, details = null, cause = null) {
    super(message, cause ? { cause } : undefined)
    this.name = 'CliError'
    this.code = code
    this.details = details
  }
}

function exitCodeFor(errorOrCode) {
  const code = typeof errorOrCode === 'string' ? errorOrCode : errorOrCode?.code
  return EXIT_CODES[code] || 4
}

module.exports = { CliError, EXIT_CODES, exitCodeFor }
