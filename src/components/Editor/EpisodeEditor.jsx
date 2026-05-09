import React, { useState, useEffect, useMemo } from 'react'
import {
  Card, Input, Button, Typography, Space, Tag,
  Switch, Radio, message, Collapse, Modal, Alert, Progress, Image
} from 'antd'
import {
  RobotOutlined, SendOutlined, PictureOutlined,
  SoundOutlined, BulbOutlined, ExclamationCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons'

const { Text, Title } = Typography
const { TextArea } = Input

import { DEFAULT_NAME_TEMPLATE, DEFAULT_INTRO_TEMPLATE } from '../../constants/defaults'

// 从 system prompt 中提取 JSON 字段定义，动态决定显示哪些结构化字段
const FIELD_META = {
  projectName: { label: '企划/IP名称', placeholder: '如：某科学的超电磁炮' },
  songTitle: { label: '歌曲标题', placeholder: '' },
  artistName: { label: '歌手', placeholder: '' },
  originalTitle: { label: '原始标题（翻译前）', placeholder: '日语原标题（如有翻译）' },
  lyricist: { label: '作词', placeholder: '' },
  composer: { label: '作曲', placeholder: '' },
  arranger: { label: '编曲', placeholder: '' },
  releaseDate: { label: '发售时间', placeholder: '' },
  cast: { label: '参与演出', placeholder: '角色/声优列表' },
}

function parsePromptFields(systemPrompt) {
  if (!systemPrompt) return Object.keys(FIELD_META)
  // 从 prompt 的 JSON 示例中提取字段名
  const matches = systemPrompt.match(/"(\w+)"\s*:/g)
  if (!matches) return Object.keys(FIELD_META)
  const fields = matches.map(m => m.match(/"(\w+)"/)[1]).filter(f => FIELD_META[f])
  return fields.length > 0 ? fields : Object.keys(FIELD_META)
}

export default function EpisodeEditor({ podcast, files, onComplete }) {
  const [episodes, setEpisodes] = useState([])
  const [activeKey, setActiveKey] = useState(null)
  const [llmLoading, setLlmLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitProgress, setSubmitProgress] = useState({ current: 0, total: 0 })
  const [settings, setSettings] = useState({})
  const [messageApi, contextHolder] = message.useMessage()

  const promptFields = useMemo(() => parsePromptFields(settings.systemPrompt), [settings.systemPrompt])

  useEffect(() => {
    console.log('[Editor] Received files:', files.map(f => ({ name: f.name, path: f.path, hasPath: !!f.path })))
    const initialEpisodes = files.map((file, index) => {
      const tags = file.audioTags || {}
      // 用标签自动生成初始名称：优先用 title tag
      const defaultName = tags.title || file.metadata?.name || file.name.replace(/\.[^.]+$/, '')

      return {
        id: `ep-${index}`,
        filePath: file.path,
        fileName: file.name,
        name: defaultName,
        description: file.metadata?.description || '',
        isPrivate: false,
        publishNow: true,
        publishNote: false,
        // 封面
        coverPreview: file.effectiveCover || file.customCover || file.cover || null,
        coverImgId: '',
        // 音频标签（来自 ID3/M4A）
        audioTags: file.audioTags || null,
        // LLM
        llmInput: '',
        originalTitle: tags.title || '',
        lyricist: '', // ID3v2 没有专门的 lyricist 帧
        composer: tags.composer || '',
        arranger: '',
        artistName: tags.artist || '',
        projectName: tags.album || '',
        cast: '',
        status: 'pending',
        error: null,
      }
    })
    setEpisodes(initialEpisodes)
    if (initialEpisodes.length > 0) setActiveKey(initialEpisodes[0].id)
    loadSettings()
  }, [files])

  const loadSettings = async () => {
    try {
      const s = await window.electronAPI.getSettings()
      setSettings(s)
    } catch (err) {
      console.warn('[Editor] 加载设置失败:', err.message)
    }
  }

  const updateEpisode = (id, updates) => {
    setEpisodes(prev => prev.map(ep => ep.id === id ? { ...ep, ...updates } : ep))
  }

  // 从音频标签填充到文本框
  const handleExtractTags = (episode) => {
    if (!episode.audioTags) {
      messageApi.warning('该音频文件没有标签信息')
      return
    }
    const tags = episode.audioTags
    const parts = []
    if (tags.title) parts.push(`标题: ${tags.title}`)
    if (tags.artist) parts.push(`歌手: ${tags.artist}`)
    if (tags.album) parts.push(`专辑: ${tags.album}`)
    if (tags.composer) parts.push(`作曲: ${tags.composer}`)
    if (tags.year) parts.push(`年份: ${tags.year}`)
    if (tags.genre) parts.push(`流派: ${tags.genre}`)
    updateEpisode(episode.id, { llmInput: parts.join('\n') })
    messageApi.success('已从音频标签提取信息')
  }

  const handleLLMParse = async (episode) => {
    const inputText = episode.llmInput?.trim() || ''
    if (!inputText) {
      messageApi.warning('请先输入歌曲信息文本，或点击「从音频标签提取」')
      return
    }

    try {
      setLlmLoading(true)
      const template = {
        nameTemplate: settings.nameTemplate || DEFAULT_NAME_TEMPLATE,
        introTemplate: settings.introTemplate || DEFAULT_INTRO_TEMPLATE,
      }
      const result = await window.electronAPI.parseWithLLM(inputText, template)
      updateEpisode(episode.id, {
        name: result.name || episode.name,
        description: result.description || episode.description,
        originalTitle: result.raw?.originalTitle || '',
        lyricist: result.raw?.lyricist || '',
        composer: result.raw?.composer || '',
        arranger: result.raw?.arranger || '',
        artistName: result.raw?.artistName || '',
        projectName: result.raw?.projectName || '',
        cast: result.raw?.cast || '',
      })
      messageApi.success('AI解析完成，请检查并确认信息')
    } catch (err) {
      messageApi.error('AI解析失败: ' + (err.message || '未知错误'))
    } finally {
      setLlmLoading(false)
    }
  }

  const regenerateFromFields = (episode) => {
    const data = {
      projectName: episode.projectName || '',
      songTitle: episode.originalTitle || episode.name || '',
      artistName: episode.artistName || '',
      originalTitle: episode.originalTitle || '',
      lyricist: episode.lyricist || '',
      composer: episode.composer || '',
      arranger: episode.arranger || '',
      releaseDate: episode.releaseDate || '',
      cast: episode.cast || '',
    }
    let name = (settings.nameTemplate || DEFAULT_NAME_TEMPLATE)
    for (const [key, value] of Object.entries(data)) {
      name = name.replaceAll(`{${key}}`, value || '')
    }
    name = name.replace(/【】/g, '').replace(/\s+/g, ' ').trim()

    const introTemplate = settings.introTemplate || DEFAULT_INTRO_TEMPLATE
    const introLines = []
    for (const line of introTemplate.split('\n')) {
      const match = line.match(/^([^：]+)：\{(\w+)\}$/)
      if (match) {
        const [, label, key] = match
        if (data[key]) introLines.push(`${label}：${data[key]}`)
      } else {
        let formatted = line
        for (const [key, value] of Object.entries(data)) {
          formatted = formatted.replaceAll(`{${key}}`, value || '')
        }
        if (formatted.includes('：') && !formatted.endsWith('：')) introLines.push(formatted)
      }
    }
    updateEpisode(episode.id, { name, description: introLines.join('\n') })
  }

  // 上传封面图片到网易云
  const uploadCover = async (coverBase64) => {
    if (!coverBase64) return ''
    try {
      const result = await window.electronAPI.uploadCover(coverBase64, 'cover.jpg')
      return result.picId || ''
    } catch (err) {
      console.error('[Editor] Upload cover failed:', err.message)
      return ''
    }
  }

  const handleSubmitAll = () => {
    const pending = episodes.filter(ep => ep.status !== 'done')
    if (pending.length === 0) {
      messageApi.info('所有单集已提交完成')
      onComplete()
      return
    }
    Modal.confirm({
      title: '确认提交',
      icon: <ExclamationCircleOutlined />,
      content: `即将提交 ${pending.length} 个单集到「${podcast?.name}」，确定继续？`,
      okText: '确认提交',
      cancelText: '取消',
      onOk: () => doSubmitAll(pending),
    })
  }

  const doSubmitAll = async (pendingEpisodes) => {
    setSubmitting(true)
    setSubmitProgress({ current: 0, total: pendingEpisodes.length })

    let successCount = 0
    let failCount = 0

    for (let i = 0; i < pendingEpisodes.length; i++) {
      const ep = pendingEpisodes[i]
      setSubmitProgress({ current: i + 1, total: pendingEpisodes.length })
      updateEpisode(ep.id, { status: 'submitting' })

      try {
        // 先上传封面（如果有）
        let coverImgId = ep.coverImgId
        // 只有当 coverImgId 是纯数字（真实 picId）时才使用，否则清空
        if (coverImgId && !/^\d+$/.test(coverImgId)) {
          coverImgId = ''
        }
        if (!coverImgId && ep.coverPreview) {
          coverImgId = await uploadCover(ep.coverPreview)
          // 验证返回的 picId 是否有效（应为纯数字）
          if (coverImgId && !/^\d+$/.test(coverImgId)) {
            console.warn('[Editor] Invalid picId from cover upload:', coverImgId)
            coverImgId = ''
          }
          if (coverImgId) {
            updateEpisode(ep.id, { coverImgId })
          }
        }

        console.log('[Editor] Submitting episode:', ep.name, 'filePath:', ep.filePath)
        const result = await window.electronAPI.uploadAudio(
          podcast.id,
          ep.filePath,
          {
            name: ep.name,
            description: ep.description,
            isPrivate: ep.isPrivate,
            publishNow: ep.publishNow,
            coverImgId: coverImgId,
          }
        )

        if (result.success) {
          updateEpisode(ep.id, { status: 'done' })
          successCount++
        } else {
          updateEpisode(ep.id, { status: 'error', error: result.message || '提交失败' })
          failCount++
        }
      } catch (err) {
        updateEpisode(ep.id, { status: 'error', error: err.message })
        failCount++
      }
    }

    setSubmitting(false)
    if (failCount === 0) {
      messageApi.success(`全部 ${successCount} 个单集提交成功！`)
      onComplete()
    } else {
      messageApi.warning(`提交完成：成功 ${successCount}，失败 ${failCount}`)
    }
  }

  const getStatusTag = (status) => {
    const map = {
      pending: { color: 'default', text: '待提交' },
      submitting: { color: 'processing', text: '提交中...' },
      done: { color: 'success', text: '已提交' },
      error: { color: 'error', text: '失败' },
    }
    const s = map[status] || map.pending
    return <Tag color={s.color}>{s.text}</Tag>
  }

  const collapseItems = episodes.map((ep) => ({
    key: ep.id,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        {ep.coverPreview ? (
          <Image src={ep.coverPreview} width={32} height={32} style={{ borderRadius: 4, objectFit: 'cover' }} preview={false} />
        ) : (
          <SoundOutlined style={{ color: '#1677ff' }} />
        )}
        <Text strong ellipsis style={{ flex: 1 }}>{ep.name || ep.fileName}</Text>
        {ep.coverPreview && <Tag color="green" style={{ fontSize: 11 }}>有封面</Tag>}
        {getStatusTag(ep.status)}
      </div>
    ),
    children: (
      <div className="two-column-panel">
        {/* 左栏 */}
        <div>
          {/* 封面预览 */}
          {ep.coverPreview && (
            <Card title={<><PictureOutlined /> 封面预览</>} size="small" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Image
                  src={ep.coverPreview}
                  width={120}
                  height={120}
                  style={{ borderRadius: 8, objectFit: 'cover' }}
                />
                <div>
                  <Tag color="green">已设置封面</Tag>
                  <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                    封面将在上传时一并提交
                  </Text>
                </div>
              </div>
            </Card>
          )}

          <Card title={<><RobotOutlined /> AI智能填写</>} size="small" style={{ marginBottom: 16 }}>
            <TextArea
              placeholder="粘贴歌曲的自然语言描述..."
              value={ep.llmInput}
              onChange={(e) => updateEpisode(ep.id, { llmInput: e.target.value })}
              rows={5}
              className="llm-input-area"
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <Button
                type="primary"
                icon={<BulbOutlined />}
                onClick={() => handleLLMParse(ep)}
                loading={llmLoading}
              >
                AI 解析生成
              </Button>
              <Button
                icon={<FileTextOutlined />}
                onClick={() => handleExtractTags(ep)}
                disabled={!ep.audioTags}
              >
                从音频标签提取
              </Button>
            </div>
            {!settings.openaiApiKey && (
              <Alert message="未配置 OpenAI API Key，请在设置中配置" type="warning" showIcon style={{ marginTop: 8 }} banner />
            )}
          </Card>

          <Card title="结构化字段" size="small">
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              {promptFields.map(field => {
                const meta = FIELD_META[field]
                if (!meta) return null
                // 作词/作曲/编曲/发售时间 两列排列
                if (['lyricist', 'composer', 'arranger', 'releaseDate'].includes(field)) return null
                return (
                  <div key={field}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{meta.label}</Text>
                    <Input
                      value={ep[field] || ''}
                      onChange={(e) => updateEpisode(ep.id, { [field]: e.target.value })}
                      placeholder={meta.placeholder}
                      size="small"
                    />
                  </div>
                )
              })}
              {/* 两列字段行 */}
              {(() => {
                const twoColFields = promptFields.filter(f => ['lyricist', 'composer', 'arranger', 'releaseDate'].includes(f))
                const rows = []
                for (let i = 0; i < twoColFields.length; i += 2) {
                  const left = twoColFields[i]
                  const right = twoColFields[i + 1]
                  rows.push(
                    <div key={`row-${i}`} style={{ display: 'grid', gridTemplateColumns: right ? '1fr 1fr' : '1fr', gap: 8 }}>
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>{FIELD_META[left].label}</Text>
                        <Input value={ep[left] || ''} onChange={(e) => updateEpisode(ep.id, { [left]: e.target.value })} size="small" />
                      </div>
                      {right && (
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>{FIELD_META[right].label}</Text>
                          <Input value={ep[right] || ''} onChange={(e) => updateEpisode(ep.id, { [right]: e.target.value })} size="small" />
                        </div>
                      )}
                    </div>
                  )
                }
                return rows
              })()}
              <Button size="small" onClick={() => regenerateFromFields(ep)} block>
                从字段重新生成名称和介绍
              </Button>
            </Space>
          </Card>
        </div>

        {/* 右栏 */}
        <div>
          <Card title="最终预览" size="small" style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>单集名称</Text>
              <Input value={ep.name} onChange={(e) => updateEpisode(ep.id, { name: e.target.value })} placeholder="输入单集名称" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>单集介绍</Text>
              <TextArea value={ep.description} onChange={(e) => updateEpisode(ep.id, { description: e.target.value })} placeholder="输入单集介绍" rows={8} />
            </div>
          </Card>

          <Card title="选项" size="small">
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text>设为隐私单集</Text>
                <Switch checked={ep.isPrivate} onChange={(v) => updateEpisode(ep.id, { isPrivate: v })} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text>发布时间</Text>
                <Radio.Group value={ep.publishNow ? 'now' : 'scheduled'} onChange={(e) => updateEpisode(ep.id, { publishNow: e.target.value === 'now' })}>
                  <Radio value="now">立即发布</Radio>
                  <Radio value="scheduled">定时发布</Radio>
                </Radio.Group>
              </div>
            </Space>
          </Card>

          {ep.error && (
            <Alert message="提交失败" description={ep.error} type="error" showIcon style={{ marginTop: 16 }} />
          )}
        </div>
      </div>
    ),
  }))

  return (
    <div>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>编辑信息</Title>
          <Text type="secondary">编辑各单集信息后提交到「{podcast?.name}」</Text>
        </div>
        <Space>
          {submitting && <Text type="secondary">提交中 {submitProgress.current}/{submitProgress.total}</Text>}
          <Button type="primary" icon={<SendOutlined />} onClick={handleSubmitAll} loading={submitting} size="large">
            全部提交
          </Button>
        </Space>
      </div>

      {submitting && (
        <Progress percent={Math.round((submitProgress.current / submitProgress.total) * 100)} status="active" style={{ marginBottom: 16 }} />
      )}

      <Collapse
        activeKey={activeKey ? [activeKey] : []}
        onChange={(keys) => setActiveKey(keys.length > 0 ? keys[keys.length - 1] : null)}
        items={collapseItems}
      />
    </div>
  )
}
