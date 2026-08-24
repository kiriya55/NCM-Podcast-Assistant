'use strict'

const QRCode = require('qrcode')

const { CliError } = require('../errors')

const PHONE_PATTERN = /^\+?\d{6,20}$/

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function requirePhone(options, input) {
  const phone = input.phone ?? options.phone
  if (typeof phone !== 'string' || !PHONE_PATTERN.test(phone)) {
    throw new CliError('INVALID_INPUT', 'Phone number must contain 6 to 20 digits')
  }
  return phone
}

function createAuthCommands({
  authService,
  cookieStore,
  qrCode = QRCode,
  sleep = defaultSleep,
  now = () => Date.now(),
  qrTimeoutMs = 300000,
  pollIntervalMs = 2000,
}) {
  return {
    'auth status': async () => ({ isLoggedIn: Boolean(cookieStore.getToken()) }),

    'auth whoami': async () => {
      if (!cookieStore.getToken()) {
        throw new CliError('AUTH_REQUIRED', 'Login is required')
      }
      return authService.getUserInfo()
    },

    'auth sms send': async ({ options = {}, input = {} }) => {
      return authService.sendCaptcha(requirePhone(options, input))
    },

    'auth sms verify': async ({ options = {}, input = {} }) => {
      const phone = requirePhone(options, input)
      const code = input.code ?? input.smsCode
      if (typeof code !== 'string' || !code.trim()) {
        throw new CliError('INVALID_INPUT', 'SMS code must be a non-empty string')
      }
      return authService.verifyCaptcha(phone, code)
    },

    'auth logout': async ({ options = {}, input = {} }) => {
      if (!options.yes && input.confirm !== true) {
        throw new CliError('CONFIRMATION_REQUIRED', 'Logout requires --yes or confirm: true')
      }
      await authService.logout()
      return { success: true }
    },

    'auth login-qr': async ({ mode = 'human', output, signal }) => {
      if (mode === 'json') {
        throw new CliError('INVALID_INPUT', 'QR login is streaming; use --jsonl')
      }

      const { unikey } = await authService.getQRKey()
      const { qrText } = await authService.getQRCode(unikey)
      const startData = { qrUrl: qrText }
      if (mode === 'human') {
        startData.qrTerminal = await qrCode.toString(qrText, { type: 'terminal', small: true })
      }
      output.event('start', startData)

      const deadline = now() + qrTimeoutMs
      while (now() <= deadline) {
        if (signal?.aborted) {
          throw new CliError('CANCELLED', 'QR login was cancelled')
        }

        const result = await authService.checkQRLogin(unikey)
        if (result.success) return result
        if (result.code === 800) {
          throw new CliError('TIMEOUT', result.message || 'QR code expired', { code: result.code })
        }

        output.event('progress', { code: result.code, message: result.message })
        await sleep(pollIntervalMs)
      }

      throw new CliError('TIMEOUT', 'QR login timed out')
    },
  }
}

module.exports = { createAuthCommands }
