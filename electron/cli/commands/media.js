'use strict'

const fsPromises = require('node:fs/promises')
const pathModule = require('node:path')

const { CliError } = require('../errors')
const { resolveInputPath } = require('../input')

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'])
const COVER_MIME = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
})
const UPLOAD_FIELDS = new Set(['file', 'name', 'description', 'privacy', 'coverImgId'])

function requireId(value, label) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new CliError('INVALID_INPUT', `${label} must be a positive decimal identifier`)
  }
  return value
}

function asArray(value) {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function coverExtension(mime) {
  if (mime === 'image/png') return '.png'
  if (mime === 'image/webp') return '.webp'
  return '.jpg'
}

function uploadMetadata(entry) {
  const unknown = Object.keys(entry).filter(key => !UPLOAD_FIELDS.has(key))
  if (unknown.length > 0) {
    throw new CliError('INVALID_INPUT', `Unknown upload fields: ${unknown.join(', ')}`, { fields: unknown })
  }
  if (entry.name !== undefined && typeof entry.name !== 'string') {
    throw new CliError('INVALID_INPUT', 'name must be a string')
  }
  if (entry.description !== undefined && typeof entry.description !== 'string') {
    throw new CliError('INVALID_INPUT', 'description must be a string')
  }
  if (entry.privacy !== undefined && typeof entry.privacy !== 'boolean') {
    throw new CliError('INVALID_INPUT', 'privacy must be a boolean')
  }
  if (entry.coverImgId !== undefined) {
    requireId(String(entry.coverImgId), 'coverImgId')
  }

  const metadata = {}
  if (entry.name !== undefined) metadata.name = entry.name
  if (entry.description !== undefined) metadata.description = entry.description
  if (entry.privacy !== undefined) metadata.isPrivate = entry.privacy
  if (entry.coverImgId !== undefined) metadata.coverImgId = String(entry.coverImgId)
  return metadata
}

function createMediaCommands({
  podcastService,
  fs = fsPromises,
  path = pathModule,
}) {
  async function validateFile(rawPath, baseDir, kind) {
    const file = resolveInputPath(rawPath, baseDir)
    const extension = path.extname(file).toLowerCase()
    const supported = kind === 'audio' ? AUDIO_EXTENSIONS.has(extension) : Boolean(COVER_MIME[extension])
    if (!supported) {
      throw new CliError('INVALID_INPUT', `Unsupported ${kind} file extension: ${extension || '(none)'}`, { file })
    }

    let stat
    try {
      stat = await fs.stat(file)
      await fs.access(file)
    } catch (error) {
      throw new CliError('IO_ERROR', `File is not readable: ${file}`, { file }, error)
    }
    if (!stat.isFile()) {
      throw new CliError('IO_ERROR', `Path is not a file: ${file}`, { file })
    }
    return file
  }

  return {
    'audio metadata': async ({ options = {}, input = {}, inputBaseDir = process.cwd() }) => {
      const rawFiles = asArray(options.file ?? input.files)
      if (rawFiles.length === 0) {
        throw new CliError('INVALID_INPUT', 'At least one audio file is required')
      }
      const files = []
      for (const rawFile of rawFiles) files.push(await validateFile(rawFile, inputBaseDir, 'audio'))

      const rawOutputDir = options.coverOutputDir ?? input.coverOutputDir
      const outputDir = rawOutputDir ? resolveInputPath(rawOutputDir, inputBaseDir) : null
      if (outputDir) await fs.mkdir(outputDir, { recursive: true })

      const results = []
      for (const file of files) {
        const metadata = await podcastService.extractFullMetadata(file)
        let cover = null
        if (metadata.cover) {
          cover = { mime: metadata.cover.mime, size: metadata.cover.buffer.length }
          if (outputDir) {
            const basename = path.basename(file, path.extname(file))
            const coverPath = path.join(outputDir, `${basename}.cover${coverExtension(metadata.cover.mime)}`)
            await fs.writeFile(coverPath, metadata.cover.buffer)
            cover.path = coverPath
          }
        }
        results.push({ file, tags: metadata.tags || {}, cover })
      }
      return results
    },

    'upload one': async ({ options = {}, input = {}, inputBaseDir = process.cwd(), output }) => {
      const podcastId = requireId(options.podcastId, 'podcastId')
      const rawFile = options.file ?? input.file
      const file = await validateFile(rawFile, inputBaseDir, 'audio')
      const metadata = uploadMetadata(input)
      return podcastService.uploadAudio(podcastId, file, metadata, progress => {
        output?.event('progress', { file, current: 1, total: 1, progress })
      })
    },

    'upload batch': async ({ options = {}, input = {}, inputBaseDir = process.cwd(), output }) => {
      const podcastId = requireId(options.podcastId, 'podcastId')
      if (!Array.isArray(input.files) || input.files.length === 0) {
        throw new CliError('INVALID_INPUT', 'Batch input requires a non-empty files array')
      }

      const prepared = []
      for (const entry of input.files) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new CliError('INVALID_INPUT', 'Each batch entry must be an object')
        }
        const file = await validateFile(entry.file, inputBaseDir, 'audio')
        prepared.push({ file, metadata: uploadMetadata(entry) })
      }

      const summary = { succeeded: [], failed: [], total: prepared.length }
      for (let index = 0; index < prepared.length; index += 1) {
        const { file, metadata } = prepared[index]
        const current = index + 1
        try {
          const result = await podcastService.uploadAudio(podcastId, file, metadata, progress => {
            output?.event('progress', { file, current, total: prepared.length, progress })
          })
          const item = { file, success: true, result }
          summary.succeeded.push(item)
          output?.event('item-result', { ...item, current, total: prepared.length })
        } catch (error) {
          const item = { file, success: false, error: { code: error.code || 'REMOTE_ERROR', message: error.message } }
          summary.failed.push(item)
          output?.event('item-result', { ...item, current, total: prepared.length })
        }
      }

      if (summary.failed.length > 0) {
        throw new CliError('PARTIAL_FAILURE', 'One or more uploads failed', summary)
      }
      return summary
    },

    'cover upload': async ({ options = {}, input = {}, inputBaseDir = process.cwd() }) => {
      const file = await validateFile(options.file ?? input.file, inputBaseDir, 'cover')
      const extension = path.extname(file).toLowerCase()
      const buffer = await fs.readFile(file)
      return podcastService.uploadCoverImage(buffer, path.basename(file), COVER_MIME[extension])
    },

    'cover set-episode': async ({ options = {} }) => {
      const episodeId = requireId(options.episodeId, 'episodeId')
      const coverId = requireId(options.coverId, 'coverId')
      const podcastId = options.podcastId === undefined ? undefined : requireId(options.podcastId, 'podcastId')
      return podcastService.updateVoiceCover(episodeId, coverId, podcastId)
    },

    'cover set-podcast': async ({ options = {} }) => {
      const podcastId = requireId(options.podcastId, 'podcastId')
      const coverId = requireId(options.coverId, 'coverId')
      return podcastService.updatePodcastCover(podcastId, coverId)
    },
  }
}

module.exports = { createMediaCommands }
