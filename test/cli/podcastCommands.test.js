'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createPodcastCommands } = require('../../electron/cli/commands/podcast')

test('podcast list and episode get return the service results', async () => {
  const commands = createPodcastCommands({
    podcastService: {
      getPodcastList: async () => [{ id: 10, name: 'Podcast' }],
      getVoiceDetail: async id => ({ voiceId: id, voiceName: 'Episode' }),
    },
  })

  assert.deepEqual(await commands['podcast list']({ options: {}, input: {} }), [{ id: 10, name: 'Podcast' }])
  assert.deepEqual(await commands['episode get']({ options: { episodeId: '8' }, input: {} }), { voiceId: '8', voiceName: 'Episode' })
})

test('episode list normalizes and bounds numeric pagination', async () => {
  const calls = []
  const commands = createPodcastCommands({
    podcastService: {
      getEpisodeListPaged: async (...args) => {
        calls.push(args)
        return { episodes: [], total: 0, page: args[1], pageSize: args[2] }
      },
    },
  })

  assert.deepEqual(
    await commands['episode list']({ options: { podcastId: '10', page: '2', pageSize: '25' }, input: {} }),
    { episodes: [], total: 0, page: 2, pageSize: 25 }
  )
  assert.deepEqual(calls, [['10', 2, 25]])

  await assert.rejects(
    commands['episode list']({ options: { podcastId: '10', page: '0', pageSize: '101' }, input: {} }),
    error => error.code === 'INVALID_INPUT'
  )
})

test('episode commands reject non-decimal identifiers before service calls', async () => {
  let calls = 0
  const commands = createPodcastCommands({
    podcastService: { getVoiceDetail: async () => { calls += 1 } },
  })

  await assert.rejects(
    commands['episode get']({ options: { episodeId: '8 OR 1=1' }, input: {} }),
    error => error.code === 'INVALID_INPUT'
  )
  assert.equal(calls, 0)
})

test('episode update forwards only the public mutable fields', async () => {
  const calls = []
  const commands = createPodcastCommands({
    podcastService: { updateVoice: async (...args) => { calls.push(args); return { success: true } } },
  })

  assert.deepEqual(
    await commands['episode update']({
      options: { episodeId: '8' },
      input: { name: 'New', description: 'Description', privacy: true, coverImgId: '99' },
    }),
    { success: true }
  )
  assert.deepEqual(calls, [['8', { name: 'New', description: 'Description', privacy: true, coverImgId: '99' }]])
})

test('episode update rejects unknown and empty updates', async () => {
  const commands = createPodcastCommands({ podcastService: { updateVoice: async () => ({ success: true }) } })

  await assert.rejects(
    commands['episode update']({ options: { episodeId: '8' }, input: { csrf_token: 'x' } }),
    error => error.code === 'INVALID_INPUT'
  )
  await assert.rejects(
    commands['episode update']({ options: { episodeId: '8' }, input: {} }),
    error => error.code === 'INVALID_INPUT'
  )
})

test('episode delete passes multiple ids only after explicit confirmation', async () => {
  const calls = []
  const commands = createPodcastCommands({
    podcastService: { deleteVoice: async (...args) => { calls.push(args); return { success: true } } },
  })

  await assert.rejects(
    commands['episode delete']({ options: { podcastId: '10', episodeId: ['1', '2'] }, input: {} }),
    error => error.code === 'CONFIRMATION_REQUIRED'
  )
  assert.equal(calls.length, 0)

  assert.deepEqual(
    await commands['episode delete']({ options: { podcastId: '10', episodeId: ['1', '2'], yes: true }, input: {} }),
    { success: true }
  )
  assert.deepEqual(calls, [['10', ['1', '2']]])
})

test('episode delete accepts structured confirmation and structured ids', async () => {
  const calls = []
  const commands = createPodcastCommands({
    podcastService: { deleteVoice: async (...args) => { calls.push(args); return { success: true } } },
  })

  await commands['episode delete']({
    options: { podcastId: '10' },
    input: { episodeIds: ['3', '4'], confirm: true },
  })

  assert.deepEqual(calls, [['10', ['3', '4']]])
})
