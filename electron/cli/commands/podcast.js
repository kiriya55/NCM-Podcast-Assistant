'use strict'

const { CliError } = require('../errors')

const UPDATE_FIELDS = Object.freeze(['name', 'description', 'privacy', 'coverImgId'])

function requireId(value, label) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new CliError('INVALID_INPUT', `${label} must be a positive decimal identifier`)
  }
  return value
}

function integerOption(value, { label, defaultValue, min, max }) {
  if (value === undefined) return defaultValue
  if (!/^\d+$/.test(String(value))) {
    throw new CliError('INVALID_INPUT', `${label} must be an integer`)
  }
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new CliError('INVALID_INPUT', `${label} must be between ${min} and ${max}`)
  }
  return number
}

function validateUpdates(input) {
  const keys = Object.keys(input)
  if (keys.length === 0) {
    throw new CliError('INVALID_INPUT', 'At least one episode field is required')
  }

  const unknown = keys.filter(key => !UPDATE_FIELDS.includes(key))
  if (unknown.length > 0) {
    throw new CliError('INVALID_INPUT', `Unknown episode fields: ${unknown.join(', ')}`, { fields: unknown })
  }

  if (input.name !== undefined && typeof input.name !== 'string') {
    throw new CliError('INVALID_INPUT', 'name must be a string')
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    throw new CliError('INVALID_INPUT', 'description must be a string')
  }
  if (input.privacy !== undefined && typeof input.privacy !== 'boolean') {
    throw new CliError('INVALID_INPUT', 'privacy must be a boolean')
  }
  if (input.coverImgId !== undefined) {
    requireId(String(input.coverImgId), 'coverImgId')
  }

  return Object.fromEntries(keys.map(key => [key, input[key]]))
}

function createPodcastCommands({ podcastService }) {
  return {
    'podcast list': async () => podcastService.getPodcastList(),

    'episode list': async ({ options = {} }) => {
      const podcastId = requireId(options.podcastId, 'podcastId')
      const page = integerOption(options.page, { label: 'page', defaultValue: 1, min: 1, max: 1000000 })
      const pageSize = integerOption(options.pageSize, { label: 'pageSize', defaultValue: 50, min: 1, max: 100 })
      return podcastService.getEpisodeListPaged(podcastId, page, pageSize)
    },

    'episode get': async ({ options = {} }) => {
      return podcastService.getVoiceDetail(requireId(options.episodeId, 'episodeId'))
    },

    'episode update': async ({ options = {}, input = {} }) => {
      const episodeId = requireId(options.episodeId, 'episodeId')
      return podcastService.updateVoice(episodeId, validateUpdates(input))
    },

    'episode delete': async ({ options = {}, input = {} }) => {
      if (!options.yes && input.confirm !== true) {
        throw new CliError('CONFIRMATION_REQUIRED', 'Episode deletion requires --yes or confirm: true')
      }

      const podcastId = requireId(options.podcastId, 'podcastId')
      const rawIds = options.episodeId ?? input.episodeIds
      const ids = Array.isArray(rawIds) ? rawIds : rawIds === undefined ? [] : [rawIds]
      if (ids.length === 0) {
        throw new CliError('INVALID_INPUT', 'At least one episodeId is required')
      }

      const episodeIds = ids.map(id => requireId(String(id), 'episodeId'))
      return podcastService.deleteVoice(podcastId, episodeIds)
    },
  }
}

module.exports = { createPodcastCommands }
