'use strict'

const { createAuthCommands } = require('./commands/auth')
const { createLlmCommands } = require('./commands/llm')
const { createMediaCommands } = require('./commands/media')
const { createMusicPartnerCommands } = require('./commands/musicPartner')
const { createPodcastCommands } = require('./commands/podcast')
const { createSettingsCommands } = require('./commands/settings')
const { CliError } = require('./errors')

const GLOBAL_OPTIONS = new Set(['help', 'json', 'jsonl'])

const COMMAND_SPECS = Object.freeze([
  ['auth status', '查看本地登录状态', []],
  ['auth whoami', '验证登录并返回当前用户', []],
  ['auth login-qr', '通过二维码登录', []],
  ['auth sms send', '向手机号发送短信验证码', ['phone', 'input']],
  ['auth sms verify', '使用手机号和短信验证码登录', ['phone', 'input']],
  ['auth logout', '清除与 GUI 共享的登录状态', ['yes', 'input']],
  ['podcast list', '列出当前账号创建的播客', []],
  ['episode list', '分页列出播客单集', ['podcastId', 'page', 'pageSize']],
  ['episode get', '读取单集详情', ['episodeId']],
  ['episode update', '更新单集字段', ['episodeId', 'input']],
  ['episode delete', '删除一个或多个单集', ['podcastId', 'episodeId', 'yes', 'input']],
  ['audio metadata', '读取音频标签和内嵌封面', ['file', 'coverOutputDir', 'input']],
  ['upload one', '上传一个音频单集', ['podcastId', 'file', 'input']],
  ['upload batch', '按清单批量上传音频单集', ['podcastId', 'input']],
  ['cover upload', '上传封面图片', ['file', 'input']],
  ['cover set-episode', '为单集设置已上传的封面', ['episodeId', 'coverId', 'podcastId']],
  ['cover set-podcast', '为播客设置已上传的封面', ['podcastId', 'coverId']],
  ['llm parse', '使用已配置的 LLM 解析歌曲信息', ['input']],
  ['music-partner verify', '验证音乐合伙人登录状态', []],
  ['music-partner run', '在临时 Electron 窗口中音乐合伙人流程', []],
  ['settings get', '读取非敏感设置', []],
  ['settings set', '更新设置', ['input']],
])

function createRegistry({ services, commandDependencies = {} }) {
  const handlers = {
    ...createAuthCommands({
      authService: services.authService,
      cookieStore: services.cookieStore,
      ...commandDependencies.auth,
    }),
    ...createPodcastCommands({ podcastService: services.podcastService }),
    ...createMediaCommands({ podcastService: services.podcastService, ...commandDependencies.media }),
    ...createLlmCommands({ llmService: services.llmService }),
    ...createMusicPartnerCommands({
      musicPartnerService: services.musicPartnerService,
      ...commandDependencies.musicPartner,
    }),
    ...createSettingsCommands({ settingsStore: services.settingsStore, llmService: services.llmService }),
  }

  const definitions = new Map(COMMAND_SPECS.map(([name, summary, optionNames]) => [name, {
    name,
    summary,
    optionNames: new Set(optionNames),
    handler: handlers[name],
  }]))

  function list() {
    return [...definitions.values()]
      .map(({ optionNames: _optionNames, ...definition }) => definition)
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  function get(commandPath) {
    const name = Array.isArray(commandPath) ? commandPath.join(' ') : commandPath
    return definitions.get(name) || null
  }

  function validate(commandName, options = {}, positionals = []) {
    const definition = get(commandName)
    if (!definition) {
      throw new CliError('INVALID_INPUT', `Unknown command: ${Array.isArray(commandName) ? commandName.join(' ') : commandName}`)
    }
    if (positionals.length > 0) {
      throw new CliError('INVALID_INPUT', `Unexpected positional arguments: ${positionals.join(' ')}`)
    }

    const unknown = Object.keys(options).filter(name => !GLOBAL_OPTIONS.has(name) && !definition.optionNames.has(name))
    if (unknown.length > 0) {
      throw new CliError('INVALID_INPUT', `Unknown option for ${definition.name}: --${unknown[0]}`, { options: unknown })
    }
    return definition
  }

  function help(prefix = []) {
    const prefixText = Array.isArray(prefix) ? prefix.join(' ') : String(prefix || '')
    const matching = list().filter(definition => !prefixText || definition.name === prefixText || definition.name.startsWith(`${prefixText} `))
    const lines = [
      prefixText ? `Usage: ncm-podcast ${prefixText} <command> [options]` : 'Usage: ncm-podcast [--json|--jsonl] <command> [options]',
      '',
      'Commands:',
      ...matching.map(definition => `  ${definition.name.padEnd(24)} ${definition.summary}`),
      '',
      'Global options:',
      '  --json                   输出单个 JSON 对象',
      '  --jsonl                  逐行输出流式 JSON 事件',
      '  --help                   显示帮助',
    ]
    return lines.join('\n')
  }

  return { get, help, list, validate }
}

module.exports = { createRegistry }
