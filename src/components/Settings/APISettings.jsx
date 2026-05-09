import React, { useState, useEffect, useMemo } from 'react'
import { Card, Input, Button, Typography, Space, message, Tag, Alert, Modal, Tooltip } from 'antd'
import {
  SaveOutlined, KeyOutlined, SettingOutlined, InfoCircleOutlined,
  ExportOutlined, ImportOutlined, EyeOutlined, EditOutlined,
} from '@ant-design/icons'

const { Text, Title } = Typography
const { TextArea } = Input

import { DEFAULT_NAME_TEMPLATE, DEFAULT_INTRO_TEMPLATE, DEFAULT_SYSTEM_PROMPT } from '../../constants/defaults'

export default function APISettings() {
  const [settings, setSettings] = useState({
    openaiApiKey: '',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiModel: 'gpt-4o',
    nameTemplate: DEFAULT_NAME_TEMPLATE,
    introTemplate: DEFAULT_INTRO_TEMPLATE,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  })
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [promptModalOpen, setPromptModalOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState('')
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const s = await window.electronAPI.getSettings()
      if (s) {
        setSettings(prev => ({ ...prev, ...s }))
      }
    } catch (err) {
      console.error('[Settings] loadSettings error:', err)
    } finally {
      setLoaded(true)
    }
  }

  const handleSave = async () => {
    try {
      setLoading(true)
      await window.electronAPI.saveSettings(settings)
      messageApi.success('设置已保存')
    } catch (err) {
      messageApi.error('保存失败: ' + (err.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  const handleExportTemplate = () => {
    const template = {
      nameTemplate: settings.nameTemplate,
      introTemplate: settings.introTemplate,
      systemPrompt: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    }
    const json = JSON.stringify(template, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'podcast-ai-template.json'
    a.click()
    URL.revokeObjectURL(url)
    messageApi.success('模板已导出')
  }

  const handleImportTemplate = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = e.target.files[0]
      if (!file) return
      try {
        const text = await file.text()
        const template = JSON.parse(text)
        const updates = {}
        if (template.nameTemplate) updates.nameTemplate = template.nameTemplate
        if (template.introTemplate) updates.introTemplate = template.introTemplate
        if (template.systemPrompt) updates.systemPrompt = template.systemPrompt
        setSettings(prev => ({ ...prev, ...updates }))
        messageApi.success('模板已导入，请检查后保存')
      } catch (err) {
        messageApi.error('导入失败: 文件格式错误')
      }
    }
    input.click()
  }

  const handleOpenPromptEditor = () => {
    setEditingPrompt(settings.systemPrompt || DEFAULT_SYSTEM_PROMPT)
    setPromptModalOpen(true)
  }

  const validatePrompt = (prompt) => {
    const warnings = []
    if (!prompt || !prompt.trim()) return { valid: true, warnings: [] }

    // 检查是否包含 JSON 字段定义
    const jsonMatch = prompt.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) {
      warnings.push('未找到 JSON 字段定义（{}），AI 可能无法正确输出结构化数据')
    } else {
      // 检查是否包含 response_format 提示
      if (!prompt.includes('JSON') && !prompt.includes('json')) {
        warnings.push('Prompt 中未提及 JSON 输出格式，建议明确要求 JSON 格式')
      }
      // 检查关键字段
      const requiredFields = ['songTitle', 'artistName']
      for (const field of requiredFields) {
        if (!prompt.includes(`"${field}"`)) {
          warnings.push(`缺少关键字段 "${field}"，可能导致名称生成不完整`)
        }
      }
    }
    // 检查长度
    if (prompt.length > 4000) {
      warnings.push(`Prompt 过长（${prompt.length} 字符），可能增加 API 调用成本`)
    }
    return { valid: warnings.length === 0, warnings }
  }

  const promptValidation = useMemo(() => validatePrompt(editingPrompt), [editingPrompt])

  const handleSavePrompt = () => {
    if (promptValidation.warnings.length > 0) {
      Modal.confirm({
        title: 'Prompt 格式检查',
        content: (
          <div>
            <p>发现以下问题：</p>
            <ul>
              {promptValidation.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
            <p>是否仍要保存？</p>
          </div>
        ),
        okText: '仍然保存',
        cancelText: '返回修改',
        onOk: () => {
          handleChange('systemPrompt', editingPrompt)
          setPromptModalOpen(false)
          messageApi.success('Prompt 已更新（记得保存设置）')
        },
      })
    } else {
      handleChange('systemPrompt', editingPrompt)
      setPromptModalOpen(false)
      messageApi.success('Prompt 已更新（记得保存设置）')
    }
  }

  const handleResetPrompt = () => {
    setEditingPrompt(DEFAULT_SYSTEM_PROMPT)
  }

  return (
    <div className="settings-card">
      {contextHolder}
      <Title level={4}>
        <SettingOutlined style={{ marginRight: 8 }} />
        设置
      </Title>

      <Card title={<><KeyOutlined /> OpenAI API 配置</>} style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text strong>API Key</Text>
            <Input.Password
              value={settings.openaiApiKey}
              onChange={(e) => handleChange('openaiApiKey', e.target.value)}
              placeholder="sk-..."
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <Text strong>API Base URL</Text>
            <Input
              value={settings.openaiBaseUrl}
              onChange={(e) => handleChange('openaiBaseUrl', e.target.value)}
              placeholder="https://api.openai.com/v1"
              style={{ marginTop: 4 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              可替换为其他兼容 OpenAI 的 API 地址（如 DeepSeek、通义千问等）
            </Text>
          </div>
          <div>
            <Text strong>模型</Text>
            <Input
              value={settings.openaiModel}
              onChange={(e) => handleChange('openaiModel', e.target.value)}
              placeholder="gpt-4o"
              style={{ marginTop: 4 }}
            />
          </div>
        </Space>
      </Card>

      <Card
        title="AI Prompt 配置"
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Button size="small" icon={<EyeOutlined />} onClick={handleOpenPromptEditor}>
              查看/编辑 Prompt
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="自定义 System Prompt"
          description={
            <span>
              点击「查看/编辑 Prompt」可预览和修改 AI 提取信息时使用的系统提示词。
              {settings.systemPrompt && settings.systemPrompt !== DEFAULT_SYSTEM_PROMPT
                ? <Tag color="orange" style={{ marginLeft: 8 }}>已自定义</Tag>
                : <Tag color="default" style={{ marginLeft: 8 }}>使用默认</Tag>
              }
            </span>
          }
        />
      </Card>

      <Card
        title="名称模板"
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Tooltip title="导出所有模板为 JSON 文件">
              <Button size="small" icon={<ExportOutlined />} onClick={handleExportTemplate}>导出</Button>
            </Tooltip>
            <Tooltip title="从 JSON 文件导入模板">
              <Button size="small" icon={<ImportOutlined />} onClick={handleImportTemplate}>导入</Button>
            </Tooltip>
          </Space>
        }
      >
        <div style={{ marginBottom: 12 }}>
          <InfoCircleOutlined />{' '}
          <Text type="secondary">
            支持的变量：
            <Tag>{'{projectName}'}</Tag>
            <Tag>{'{songTitle}'}</Tag>
            <Tag>{'{artistName}'}</Tag>
          </Text>
        </div>
        <Input
          value={settings.nameTemplate}
          onChange={(e) => handleChange('nameTemplate', e.target.value)}
          placeholder={DEFAULT_NAME_TEMPLATE}
        />
        <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
          示例输出：【某科学的超电磁炮】Only My Railgun - fripSide
        </Text>
      </Card>

      <Card title="介绍模板" style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <InfoCircleOutlined />{' '}
          <Text type="secondary">
            支持的变量：
            <Tag>{'{originalTitle}'}</Tag>
            <Tag>{'{lyricist}'}</Tag>
            <Tag>{'{composer}'}</Tag>
            <Tag>{'{arranger}'}</Tag>
            <Tag>{'{artistName}'}</Tag>
            <Tag>{'{projectName}'}</Tag>
            <Tag>{'{songTitle}'}</Tag>
          </Text>
        </div>
        <TextArea
          value={settings.introTemplate}
          onChange={(e) => handleChange('introTemplate', e.target.value)}
          rows={8}
          placeholder={DEFAULT_INTRO_TEMPLATE}
        />
        <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
          每行格式为 "标签：{'{变量名}'}"，如果变量为空则该行不会显示
        </Text>
      </Card>

      <Button
        type="primary"
        icon={<SaveOutlined />}
        onClick={handleSave}
        loading={loading}
        size="large"
      >
        保存设置
      </Button>

      {/* Prompt 编辑弹窗 */}
      <Modal
        title="AI System Prompt 编辑"
        open={promptModalOpen}
        onCancel={() => setPromptModalOpen(false)}
        width={800}
        footer={
          <Space>
            <Button onClick={handleResetPrompt}>恢复默认</Button>
            <Button onClick={() => setPromptModalOpen(false)}>取消</Button>
            <Button type="primary" onClick={handleSavePrompt}>确定</Button>
          </Space>
        }
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="修改 Prompt 可能影响 AI 提取效果"
          description="Prompt 中定义了 JSON 输出格式和提取规则。修改时请确保保留 JSON 字段定义部分，否则解析可能失败。"
        />
        {promptValidation.warnings.length > 0 && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="格式检查发现问题"
            description={
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {promptValidation.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            }
          />
        )}
        {promptValidation.warnings.length === 0 && editingPrompt && editingPrompt.trim() && (
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
            message="格式检查通过"
          />
        )}
        <TextArea
          value={editingPrompt}
          onChange={(e) => setEditingPrompt(e.target.value)}
          rows={20}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
        />
      </Modal>
    </div>
  )
}
