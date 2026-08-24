'use strict'

const crypto = require('node:crypto')
const { spawn: nodeSpawn } = require('node:child_process')
const readline = require('node:readline')

const { CliError, exitCodeFor } = require('./errors')
const { createCliServices, resolveDataDir } = require('./storage')
const { createCheckpointStore } = require('../musicPartner/checkpointStore')
const { createPageAdapter } = require('../musicPartner/pageAdapter')
const { createMusicPartnerRunController, isManualIntervention } = require('../musicPartner/runController')
const { createMusicPartnerWindow } = require('../musicPartner/window')

const CHILD_ENV_KEYS = Object.freeze([
  'PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE',
  'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'LANG', 'NCM_DATA_DIR',
])
const FORWARDED_EVENTS = new Set(['state', 'progress', 'intervention', 'resume'])
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_INTERVENTION_POLL_MS = 500

function buildChildEnv(env, authorization) {
  const childEnv = {}
  for (const key of CHILD_ENV_KEYS) {
    if (env[key] !== undefined) childEnv[key] = String(env[key])
  }
  childEnv.NCM_MP_RUN_AUTH = authorization
  return childEnv
}

function spawnMusicPartnerRunner({
  electronPath,
  runnerPath = __filename,
  env = process.env,
  signal,
  spawn = nodeSpawn,
  randomBytes = crypto.randomBytes,
  onEvent = () => {},
  onDiagnostic = () => {},
} = {}) {
  const executable = electronPath || require('electron')
  const authorization = randomBytes(32).toString('hex')
  const child = spawn(executable, [runnerPath], {
    env: buildChildEnv(env, authorization),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  return new Promise((resolve, reject) => {
    let settled = false
    let protocolError = null
    let terminal = null
    let terminalCount = 0

    const finish = (operation, value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener?.('abort', onAbort)
      operation(value)
    }

    const failProtocol = message => {
      if (protocolError) return
      protocolError = new CliError('REMOTE_ERROR', `Invalid Music Partner child protocol: ${message}`)
      child.stdin?.end?.()
    }

    const lines = readline.createInterface({ input: child.stdout })
    lines.on('line', line => {
      if (!line.trim()) return
      if (terminal) {
        terminalCount += 1
        failProtocol('multiple terminal events')
        return
      }

      let message
      try {
        message = JSON.parse(line)
      } catch (_) {
        failProtocol('malformed JSON line')
        return
      }

      if (!message || typeof message.event !== 'string' || !Object.hasOwn(message, 'data')) {
        failProtocol('event and data are required')
        return
      }
      if (FORWARDED_EVENTS.has(message.event)) {
        onEvent(message.event, message.data)
        return
      }
      if (message.event === 'result' || message.event === 'error') {
        terminal = message
        terminalCount += 1
        return
      }
      failProtocol(`unknown event ${message.event}`)
    })

    child.stderr?.on?.('data', chunk => onDiagnostic(String(chunk).replace(/\r?\n$/, '')))

    const onAbort = () => child.stdin?.end?.()
    if (signal?.aborted) onAbort()
    else signal?.addEventListener?.('abort', onAbort, { once: true })

    child.once('error', error => finish(reject, new CliError('REMOTE_ERROR', 'Unable to start Music Partner Electron runner', null, error)))
    child.once('close', (code, childSignal) => {
      lines.close()
      if (protocolError) return finish(reject, protocolError)
      if (signal?.aborted) return finish(reject, new CliError('CANCELLED', 'Music Partner automation was cancelled'))
      if (terminalCount !== 1 || !terminal) {
        return finish(reject, new CliError('REMOTE_ERROR', 'Music Partner child exited without one terminal event', { exitCode: code, signal: childSignal }))
      }
      if (terminal.event === 'error') {
        const data = terminal.data || {}
        return finish(reject, new CliError(data.code || 'REMOTE_ERROR', data.message || 'Music Partner automation failed', data.details ?? null))
      }
      if (code !== 0 || childSignal) {
        return finish(reject, new CliError('REMOTE_ERROR', 'Music Partner child exited unexpectedly', { exitCode: code, signal: childSignal }))
      }
      finish(resolve, terminal.data)
    })
  })
}

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createDefaultCheckpoint(dataDir) {
  const Store = require('electron-store')
  return createCheckpointStore({ backend: new Store({ name: 'music-partner-automation', cwd: dataDir }) })
}

function normalizeChildError(error, stopError) {
  if (error instanceof CliError) return error
  if (stopError instanceof CliError) return stopError
  return new CliError('REMOTE_ERROR', error?.message || 'Music Partner automation failed', null, error)
}

async function runMusicPartnerChild(dependencies = {}) {
  const electron = dependencies.app && dependencies.BrowserWindow ? null : require('electron')
  const app = dependencies.app || electron.app
  const BrowserWindow = dependencies.BrowserWindow || electron?.BrowserWindow
  const env = dependencies.env || process.env
  const stdin = dependencies.stdin || process.stdin
  const stdout = dependencies.stdout || process.stdout
  const stderr = dependencies.stderr || process.stderr
  const processLike = dependencies.processLike || process
  const createServices = dependencies.createServices || (options => createCliServices(options))
  const createWindow = dependencies.createWindow || createMusicPartnerWindow
  const createController = dependencies.createController || createMusicPartnerRunController
  const createAdapter = dependencies.createAdapter || createPageAdapter
  const createCheckpoint = dependencies.createCheckpoint || createDefaultCheckpoint
  const sleep = dependencies.sleep || defaultSleep
  const timeoutMs = dependencies.timeoutMs || DEFAULT_TIMEOUT_MS
  const interventionPollMs = dependencies.interventionPollMs || DEFAULT_INTERVENTION_POLL_MS
  const randomUUID = dependencies.randomUUID || crypto.randomUUID
  const setTimer = dependencies.setTimeout || setTimeout
  const clearTimer = dependencies.clearTimeout || clearTimeout

  let controller = null
  let windowHandle = null
  let windowCreationPromise = null
  let terminalWritten = false
  let cleanupPromise = null
  let stopError = null
  let controllerCancelled = false
  let rejectStop
  const stopPromise = new Promise((_, reject) => { rejectStop = reject })

  const writeEvent = (event, data) => {
    if (terminalWritten) return
    if (event === 'result' || event === 'error') terminalWritten = true
    stdout.write(`${JSON.stringify({ event, data })}\n`)
  }
  const diagnostic = (...values) => {
    stderr.write(`${values.map(value => value?.message || String(value)).join(' ')}\n`)
  }
  const cancelController = reason => {
    if (controllerCancelled || !controller?.cancel) return
    controllerCancelled = true
    try { controller.cancel(reason) } catch (_) {}
  }

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      if (stopError) cancelController(stopError.message)
      if (windowCreationPromise) {
        try { await windowCreationPromise } catch (_) {}
      }
      const activeHandle = windowHandle || controller?.getWindowHandle?.()
      if (activeHandle?.cleanup) {
        try {
          await activeHandle.cleanup({ clearStorage: true })
        } catch (error) {
          diagnostic('Music Partner cleanup failed:', error)
        }
      }
      app.quit()
    })()
    return cleanupPromise
  }

  const requestStop = error => {
    if (!stopError) {
      stopError = error instanceof CliError ? error : new CliError('REMOTE_ERROR', error?.message || String(error), null, error)
      cancelController(stopError.message)
      rejectStop(stopError)
    }
    void cleanup()
  }

  const onParentClose = () => requestStop(new CliError('CANCELLED', 'Parent process closed the runner input'))
  const onSigint = () => requestStop(new CliError('CANCELLED', 'Music Partner automation was cancelled'))
  const onSigterm = onSigint
  const onFatal = error => requestStop(error instanceof Error ? error : new Error(String(error)))
  const listeners = [
    [stdin, 'end', onParentClose],
    [stdin, 'close', onParentClose],
    [processLike, 'SIGINT', onSigint],
    [processLike, 'SIGTERM', onSigterm],
    [processLike, 'uncaughtException', onFatal],
    [processLike, 'unhandledRejection', onFatal],
  ]

  for (const [emitter, event, handler] of listeners) emitter?.once?.(event, handler)
  stdin.resume?.()

  let timeout = null
  let exitCode = 4
  try {
    const authorization = env.NCM_MP_RUN_AUTH
    delete env.NCM_MP_RUN_AUTH
    if (!authorization) throw new CliError('UNLOCK_FAILED', 'Music Partner runner authorization is missing')

    app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
    timeout = setTimer(() => requestStop(new CliError('TIMEOUT', 'Music Partner automation timed out')), timeoutMs)
    timeout.unref?.()

    const execute = async () => {
      await app.whenReady()
      if (stopError) throw stopError

      const dataDir = resolveDataDir({ env })
      const services = createServices({ dataDir, session: null })
      const verified = await services.musicPartnerService.verifyUser()
      if (!verified?.success) {
        throw new CliError('AUTH_REQUIRED', verified?.message || 'NetEase login is required')
      }
      if (stopError) throw stopError

      const partition = `music-partner-cli-${processLike.pid || process.pid}-${randomUUID()}`
      const logger = { log: diagnostic, warn: diagnostic, error: diagnostic }
      const ensureWindow = async () => {
        if (windowHandle && !windowHandle.browserWindow.isDestroyed()) return windowHandle
        if (!windowCreationPromise) {
          windowCreationPromise = createWindow({
            app, BrowserWindow, cookieStore: services.cookieStore, logger,
            partition, showOnReady: false,
          }).then(handle => {
            windowHandle = handle
            return handle
          })
        }
        try {
          return await windowCreationPromise
        } finally {
          windowCreationPromise = null
        }
      }
      const destroyWindow = async handle => {
        await handle.cleanup({ clearStorage: true })
        if (windowHandle === handle) windowHandle = null
      }

      windowHandle = await ensureWindow()
      if (stopError) throw stopError
      controller = createController({
        checkpointStore: createCheckpoint(dataDir),
        destroyWindow,
        emit: state => writeEvent('state', state),
        ensureWindow,
        logger,
      })

      while (true) {
        if (stopError) throw stopError
        const result = await controller.start()
        if (result?.success) return result
        if (result?.code === 'cancelled') {
          throw new CliError('CANCELLED', result.reason || 'Music Partner automation was cancelled')
        }
        if (!isManualIntervention(result)) {
          throw new CliError('REMOTE_ERROR', result?.reason || 'Music Partner automation did not complete', { code: result?.code || null })
        }

        const activeHandle = controller.getWindowHandle?.() || windowHandle
        activeHandle.show()
        activeHandle.focus()
        writeEvent('intervention', {
          status: 'paused',
          reasonCode: 'manual-intervention-required',
          message: 'Manual intervention is required in the Electron window',
        })

        const adapter = createAdapter({
          getWebContents: () => activeHandle.browserWindow.isDestroyed() ? null : activeHandle.browserWindow.webContents,
          getUrl: () => activeHandle.browserWindow.isDestroyed() ? '' : activeHandle.browserWindow.webContents.getURL(),
        })
        while (true) {
          if (stopError) throw stopError
          const state = await adapter.inspect()
          if (state?.kind !== 'intervention') break
          await sleep(interventionPollMs)
        }
        writeEvent('resume', { status: 'preparing' })
      }
    }

    const result = await Promise.race([execute(), stopPromise])
    writeEvent('result', result)
    exitCode = 0
  } catch (error) {
    const normalized = normalizeChildError(error, stopError)
    writeEvent('error', { code: normalized.code, message: normalized.message, details: normalized.details })
    exitCode = exitCodeFor(normalized)
  } finally {
    if (timeout) clearTimer(timeout)
    for (const [emitter, event, handler] of listeners) emitter?.removeListener?.(event, handler)
    await cleanup()
  }
  return exitCode
}

if (require.main === module) {
  runMusicPartnerChild().then(code => {
    process.exitCode = code
  }).catch(error => {
    process.stderr.write(`${error?.message || error}\n`)
    process.exitCode = 4
  })
}

module.exports = {
  CHILD_ENV_KEYS,
  buildChildEnv,
  runMusicPartnerChild,
  spawnMusicPartnerRunner,
}
