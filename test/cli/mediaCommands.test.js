'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createMediaCommands } = require('../../electron/cli/commands/media')

function tempWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncm-cli-media-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function writeFile(root, name, contents = 'audio') {
  const file = path.join(root, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
  return file
}

function eventOutput() {
  const events = []
  return { events, output: { event: (name, data) => events.push({ name, data }) } }
}

test('audio metadata omits embedded cover bytes by default', async (t) => {
  const root = tempWorkspace(t)
  const audioFile = writeFile(root, 'song.mp3')
  const commands = createMediaCommands({
    podcastService: {
      extractFullMetadata: () => ({
        tags: { title: 'Song' },
        cover: { buffer: Buffer.from('image'), mime: 'image/jpeg' },
      }),
    },
  })

  assert.deepEqual(
    await commands['audio metadata']({ options: { file: [audioFile] }, input: {}, inputBaseDir: root }),
    [{ file: audioFile, tags: { title: 'Song' }, cover: { mime: 'image/jpeg', size: 5 } }]
  )
})

test('audio metadata writes an embedded cover only when an output directory is requested', async (t) => {
  const root = tempWorkspace(t)
  const audioFile = writeFile(root, 'album/song.flac')
  const outputDir = path.join(root, 'covers')
  const commands = createMediaCommands({
    podcastService: {
      extractFullMetadata: () => ({ tags: {}, cover: { buffer: Buffer.from('png-data'), mime: 'image/png' } }),
    },
  })

  const [result] = await commands['audio metadata']({
    options: { file: [audioFile], coverOutputDir: outputDir }, input: {}, inputBaseDir: root,
  })

  assert.equal(result.cover.path, path.join(outputDir, 'song.cover.png'))
  assert.equal(fs.readFileSync(result.cover.path, 'utf8'), 'png-data')
  assert.equal(result.cover.buffer, undefined)
})

test('media commands reject unsupported files before calling a service', async (t) => {
  const root = tempWorkspace(t)
  const file = writeFile(root, 'notes.txt')
  let calls = 0
  const commands = createMediaCommands({
    podcastService: { extractFullMetadata: () => { calls += 1 } },
  })

  await assert.rejects(
    commands['audio metadata']({ options: { file: [file] }, input: {}, inputBaseDir: root }),
    error => error.code === 'INVALID_INPUT'
  )
  assert.equal(calls, 0)
})

test('upload one maps public privacy metadata and emits service progress', async (t) => {
  const root = tempWorkspace(t)
  const audioFile = writeFile(root, 'song.mp3')
  const calls = []
  const observed = eventOutput()
  const commands = createMediaCommands({
    podcastService: {
      uploadAudio: async (podcastId, file, metadata, onProgress) => {
        calls.push([podcastId, file, metadata])
        onProgress(40)
        onProgress(100)
        return { success: true, data: { voiceId: 5 } }
      },
    },
  })

  assert.deepEqual(
    await commands['upload one']({
      options: { podcastId: '7', file: audioFile },
      input: { name: 'Episode', description: 'Intro', privacy: true, coverImgId: '9' },
      inputBaseDir: root,
      output: observed.output,
    }),
    { success: true, data: { voiceId: 5 } }
  )
  assert.deepEqual(calls, [[
    '7', audioFile,
    { name: 'Episode', description: 'Intro', isPrivate: true, coverImgId: '9' },
  ]])
  assert.deepEqual(observed.events, [
    { name: 'progress', data: { file: audioFile, current: 1, total: 1, progress: 40 } },
    { name: 'progress', data: { file: audioFile, current: 1, total: 1, progress: 100 } },
  ])
})

test('upload batch continues after remote failures and returns a partial-failure summary', async (t) => {
  const root = tempWorkspace(t)
  const first = writeFile(root, 'first.mp3')
  const second = writeFile(root, 'second.wav')
  const observed = eventOutput()
  const calls = []
  const commands = createMediaCommands({
    podcastService: {
      uploadAudio: async (_podcastId, file, metadata, onProgress) => {
        calls.push([file, metadata])
        onProgress(50)
        if (file === first) throw new Error('remote rejected first')
        return { success: true, data: { voiceId: 2 } }
      },
    },
  })

  let caught
  try {
    await commands['upload batch']({
      options: { podcastId: '7' },
      input: { files: [
        { file: './first.mp3', name: 'First' },
        { file: './second.wav', name: 'Second', privacy: false },
      ] },
      inputBaseDir: root,
      output: observed.output,
    })
  } catch (error) {
    caught = error
  }

  assert.equal(caught.code, 'PARTIAL_FAILURE')
  assert.equal(caught.details.total, 2)
  assert.equal(caught.details.succeeded.length, 1)
  assert.equal(caught.details.failed.length, 1)
  assert.deepEqual(calls.map(call => call[0]), [first, second])
  assert.deepEqual(observed.events.filter(item => item.name === 'item-result').map(item => item.data.success), [false, true])
})

test('upload batch validates every local file before starting network work', async (t) => {
  const root = tempWorkspace(t)
  writeFile(root, 'first.mp3')
  let calls = 0
  const commands = createMediaCommands({
    podcastService: { uploadAudio: async () => { calls += 1 } },
  })

  await assert.rejects(
    commands['upload batch']({
      options: { podcastId: '7' },
      input: { files: [{ file: './first.mp3' }, { file: './missing.mp3' }] },
      inputBaseDir: root,
      output: eventOutput().output,
    }),
    error => error.code === 'IO_ERROR'
  )
  assert.equal(calls, 0)
})

test('cover commands upload image bytes and assign returned identifiers', async (t) => {
  const root = tempWorkspace(t)
  const coverFile = writeFile(root, 'cover.png', 'cover-data')
  const calls = []
  const commands = createMediaCommands({
    podcastService: {
      uploadCoverImage: async (...args) => { calls.push(['upload', ...args]); return { success: true, picId: '99' } },
      updateVoiceCover: async (...args) => { calls.push(['episode', ...args]); return { success: true } },
      updatePodcastCover: async (...args) => { calls.push(['podcast', ...args]); return { success: true } },
    },
  })

  assert.deepEqual(
    await commands['cover upload']({ options: { file: coverFile }, input: {}, inputBaseDir: root }),
    { success: true, picId: '99' }
  )
  await commands['cover set-episode']({ options: { episodeId: '8', coverId: '99', podcastId: '7' }, input: {} })
  await commands['cover set-podcast']({ options: { podcastId: '7', coverId: '99' }, input: {} })

  assert.equal(calls[0][1].toString('utf8'), 'cover-data')
  assert.deepEqual(calls[0].slice(2), ['cover.png', 'image/png'])
  assert.deepEqual(calls[1], ['episode', '8', '99', '7'])
  assert.deepEqual(calls[2], ['podcast', '7', '99'])
})
