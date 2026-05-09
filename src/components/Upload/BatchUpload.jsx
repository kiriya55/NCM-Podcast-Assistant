import React, { useState, useEffect } from 'react'
import {
  Card, Button, Typography, List, Tag, Space, message, Image,
  Tooltip,
} from 'antd'
import {
  CloudUploadOutlined, InboxOutlined, DeleteOutlined, SoundOutlined,
  ArrowUpOutlined, ArrowDownOutlined, PictureOutlined,
  SortAscendingOutlined, SortDescendingOutlined,
} from '@ant-design/icons'

const { Text, Title } = Typography

const ACCEPTED_FORMATS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']
const COVER_FORMATS = ['.jpg', '.jpeg', '.png', '.webp']

export default function BatchUpload({ podcast, onComplete }) {
  const [files, setFiles] = useState([])
  const [globalCover, setGlobalCover] = useState(null) // 批量统一封面
  const [sortOrder, setSortOrder] = useState('asc') // 'asc' | 'desc'
  const [messageApi, contextHolder] = message.useMessage()

  const createFileEntry = (filePath, name, size = 0) => {
    const ext = name.substring(name.lastIndexOf('.')).toLowerCase()
    return {
      path: filePath,
      name,
      ext,
      size,
      cover: null,
      customCover: null,
      audioTags: null,
      metadata: {
        name: name.replace(/\.[^.]+$/, ''),
        description: '',
        coverImgId: '',
      },
    }
  }

  const handleSelectFiles = async () => {
    const filePaths = await window.electronAPI.selectFiles()
    if (filePaths.length > 0) {
      const newFiles = filePaths.map((fp) => {
        const name = fp.split(/[\\/]/).pop()
        return createFileEntry(fp, name)
      })
      setFiles((prev) => [...prev, ...newFiles])

      // 自动提取标签和封面
      extractMetadata(filePaths)
    }
  }

  // 选择文件后自动提取音频元数据（标签+封面，单次读取）
  const extractMetadata = async (filePaths) => {
    try {
      const metadata = await window.electronAPI.batchExtractMetadata(filePaths)

      let tagCount = 0
      let coverCount = 0

      setFiles(prev => prev.map(f => {
        const data = metadata[f.path]
        if (!data) return f
        if (data.tags) tagCount++
        if (data.cover) coverCount++

        return {
          ...f,
          cover: data.cover?.base64 || null,
          audioTags: data.tags,
        }
      }))

      if (tagCount > 0 || coverCount > 0) {
        const parts = []
        if (tagCount > 0) parts.push(`${tagCount} 个有标签信息`)
        if (coverCount > 0) parts.push(`${coverCount} 个有封面`)
        messageApi.success(`已自动提取：${parts.join('，')}`)
      }
    } catch (err) {
      console.error('[BatchUpload] extractMetadata error:', err)
    }
  }

  // 设置全局封面（应用到所有没有自定义封面的文件）
  const handleSetGlobalCover = async () => {
    const paths = await window.electronAPI.selectCoverFiles()
    if (paths.length === 0) return

    try {
      const coverPath = paths[0]
      const coverName = coverPath.split(/[\\/]/).pop()
      const base64 = await window.electronAPI.readImageBase64(coverPath)

      if (base64) {
        setGlobalCover(base64)
        messageApi.success(`已设置全局封面：${coverName}`)
      } else {
        messageApi.error('读取图片失败')
      }
    } catch (err) {
      messageApi.error('设置封面失败: ' + (err.message || '未知错误'))
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const droppedFiles = Array.from(e.dataTransfer.files)
    const validFiles = droppedFiles
      .filter((f) => {
        const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase()
        return ACCEPTED_FORMATS.includes(ext)
      })
      .map((f) => createFileEntry(window.electronAPI.getFilePath(f), f.name, f.size))

    if (validFiles.length > 0) {
      setFiles((prev) => [...prev, ...validFiles])
      // 自动提取标签和封面
      extractMetadata(validFiles.map(f => f.path))
    }
    if (validFiles.length < droppedFiles.length) {
      messageApi.warning('部分文件格式不支持，已过滤')
    }
  }

  const handleRemoveFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleMoveUp = (index) => {
    if (index === 0) return
    setFiles((prev) => {
      const n = [...prev]
      ;[n[index - 1], n[index]] = [n[index], n[index - 1]]
      return n
    })
  }

  const handleMoveDown = (index) => {
    setFiles((prev) => {
      if (index >= prev.length - 1) return prev
      const n = [...prev]
      ;[n[index], n[index + 1]] = [n[index + 1], n[index]]
      return n
    })
  }

  // 设置单个文件的封面
  const handleSetFileCover = async (index) => {
    const paths = await window.electronAPI.selectCoverFiles()
    if (paths.length === 0) return

    try {
      const coverPath = paths[0]
      const base64 = await window.electronAPI.readImageBase64(coverPath)
      if (base64) {
        setFiles(prev => prev.map((f, i) =>
          i === index ? { ...f, customCover: base64 } : f
        ))
      } else {
        messageApi.error('读取图片失败')
      }
    } catch (err) {
      messageApi.error('设置封面失败')
    }
  }

  const handleSort = (order) => {
    setSortOrder(order)
    setFiles(prev => {
      const sorted = [...prev].sort((a, b) => {
        const cmp = a.name.localeCompare(b.name, 'zh-CN')
        return order === 'asc' ? cmp : -cmp
      })
      return sorted
    })
  }

  const handleUploadAll = () => {
    if (files.length === 0) {
      messageApi.warning('请先选择音频文件')
      return
    }
    // 传递文件列表（含封面和标签）到编辑阶段
    onComplete(files.map(f => ({
      ...f,
      effectiveCover: f.customCover || globalCover || f.cover || null,
    })))
  }

  const getCoverPreview = (file) => {
    return file.customCover || globalCover || file.cover || null
  }

  const coverCount = files.filter(f => getCoverPreview(f)).length

  return (
    <div>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>上传音频</Title>
          <Text type="secondary">
            向「{podcast?.name}」上传音频文件（支持 mp3/wav/m4a/aac/ogg/flac）
          </Text>
        </div>
        <Space>
          <Button icon={<CloudUploadOutlined />} onClick={handleSelectFiles}>选择文件</Button>
          <Button
            type="primary"
            disabled={files.length === 0}
            onClick={handleUploadAll}
          >
            下一步：编辑信息（{files.length} 个文件）
          </Button>
        </Space>
      </div>

      {/* 拖拽区域 */}
      <div
        className="file-drop-zone"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={handleSelectFiles}
        style={{ marginBottom: 24 }}
      >
        <InboxOutlined style={{ fontSize: 48, color: '#1677ff', marginBottom: 16 }} />
        <Title level={5} style={{ marginBottom: 4 }}>拖拽音频文件到此处</Title>
        <Text type="secondary">或点击选择文件，支持批量选择</Text>
      </div>

      {/* 封面操作栏 */}
      {files.length > 0 && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <PictureOutlined style={{ fontSize: 16, color: '#1677ff' }} />
              <Text strong>封面管理</Text>
              <Text type="secondary">（{coverCount}/{files.length} 个文件有封面）</Text>
            </Space>
            <Space>
              <Button
                icon={<PictureOutlined />}
                onClick={handleSetGlobalCover}
              >
                设置统一封面
              </Button>
              {globalCover && (
                <Space>
                  <Image
                    src={globalCover}
                    width={32}
                    height={32}
                    style={{ borderRadius: 4, objectFit: 'cover' }}
                    preview={false}
                  />
                  <Tag color="green">全局封面已设置</Tag>
                  <Button type="link" size="small" onClick={() => setGlobalCover(null)}>
                    清除
                  </Button>
                </Space>
              )}
            </Space>
          </div>
        </Card>
      )}

      {/* 文件列表 */}
      {files.length > 0 && (
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>文件列表（{files.length} 个）</span>
              <Tag color={sortOrder === 'asc' ? 'blue' : 'purple'} style={{ fontSize: 11 }}>
                {sortOrder === 'asc' ? '↑ 顺序' : '↓ 倒序'}
              </Tag>
            </div>
          }
          size="small"
          extra={
            <Space size="small">
              <Button
                size="small"
                type={sortOrder === 'asc' ? 'primary' : 'default'}
                icon={<SortAscendingOutlined />}
                onClick={() => handleSort('asc')}
              >
                顺序
              </Button>
              <Button
                size="small"
                type={sortOrder === 'desc' ? 'primary' : 'default'}
                icon={<SortDescendingOutlined />}
                onClick={() => handleSort('desc')}
              >
                倒序
              </Button>
            </Space>
          }
        >
          <List
            dataSource={files}
            renderItem={(file, index) => {
              const cover = getCoverPreview(file)
              return (
                <List.Item
                  actions={[
                    <Tooltip title="设置封面">
                      <Button
                        type="text"
                        size="small"
                        icon={<PictureOutlined />}
                        onClick={() => handleSetFileCover(index)}
                      />
                    </Tooltip>,
                    <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => handleMoveUp(index)} />,
                    <Button type="text" size="small" icon={<ArrowDownOutlined />} disabled={index === files.length - 1} onClick={() => handleMoveDown(index)} />,
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleRemoveFile(index)} />,
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      cover ? (
                        <Image
                          src={cover}
                          width={48}
                          height={48}
                          style={{ borderRadius: 4, objectFit: 'cover' }}
                          preview={{ src: cover }}
                        />
                      ) : (
                        <div style={{
                          width: 48, height: 48, borderRadius: 4,
                          background: '#f0f0f0', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          <SoundOutlined style={{ fontSize: 20, color: '#bbb' }} />
                        </div>
                      )
                    }
                    title={
                      <Space wrap>
                        <Text>{file.name}</Text>
                        <Tag>{file.ext?.toUpperCase()}</Tag>
                        {file.customCover && <Tag color="orange">自定义封面</Tag>}
                        {!file.customCover && globalCover && <Tag color="blue">全局封面</Tag>}
                        {cover && !file.customCover && !globalCover && <Tag color="green">已提取封面</Tag>}
                        {file.audioTags && <Tag color="purple">有标签</Tag>}
                      </Space>
                    }
                    description={
                      <div>
                        {file.audioTags && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {file.audioTags.title && `标题: ${file.audioTags.title}`}
                            {file.audioTags.artist && ` | 歌手: ${file.audioTags.artist}`}
                            {file.audioTags.album && ` | 专辑: ${file.audioTags.album}`}
                            {file.audioTags.composer && ` | 作曲: ${file.audioTags.composer}`}
                          </Text>
                        )}
                        <Text type="secondary" style={{ fontSize: 11, display: 'block', opacity: 0.6 }}>
                          {file.path}
                        </Text>
                      </div>
                    }
                  />
                </List.Item>
              )
            }}
          />
        </Card>
      )}
    </div>
  )
}
