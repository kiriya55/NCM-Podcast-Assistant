'use strict'

const { CliError } = require('../errors')
const { spawnMusicPartnerRunner } = require('../musicPartnerRunner')
const { validateMusicPartnerUnlock } = require('../unlock')

function createMusicPartnerCommands({
  musicPartnerService,
  validateUnlock = validateMusicPartnerUnlock,
  spawnRunner = spawnMusicPartnerRunner,
} = {}) {
  return {
    'music-partner verify': async () => musicPartnerService.verifyUser(),

    'music-partner run': async ({ env = process.env, mode = 'human', output, signal } = {}) => {
      if (mode === 'json') {
        throw new CliError('INVALID_INPUT', 'Music Partner automation is streaming; use --jsonl')
      }

      validateUnlock({ env })
      return spawnRunner({
        env,
        signal,
        onEvent: (name, data) => output.event(name, data),
        onDiagnostic: value => output.diagnostic(value),
      })
    },
  }
}

module.exports = { createMusicPartnerCommands }
