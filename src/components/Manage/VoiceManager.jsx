import React, { useState, useEffect, useRef } from 'react'
import {
  Card, Button, Typography, Space, Tag, Modal, Input, Switch, InputNumber,
  message, Popconfirm, Image, Tooltip, Descriptions, Checkbox, Pagination,
} from 'antd'
import {
  DeleteOutlined, EditOutlined, ReloadOutlined,
  LockOutlined, UnlockOutlined, SoundOutlined,
  EyeOutlined, ArrowLeftOutlined, PictureOutlined,
  DownloadOutlined,
} from '@ant-design/icons'

const { Text, Title } = Typography
const { TextArea } = Input

const STATUS_MAP = {
  public: { color: 'green', text: '公开' },
  private: { color: 'orange', text: '私密' },
}

export default function VoiceManager({ podcast, onBack }) {
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(false)
  const [editingEp, setEditingEp] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [detailEp, setDetailEp] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [messageApi, contextHolder] = message.useMessage()
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 50

  useEffect(() => {
    if (podcast) loadEpisodes(1)
  }, [podcast])

  const loadEpisodes = async (p) => {
    setLoading(true)
    try {
      const result = await window.electronAPI.getEpisodeListPaged(podcast.id, p || page, pageSize)
      setEpisodes(result.episodes)
      setTotal(result.total)
      setPage(result.page)
      setSelectedIds(new Set())
    } catch (err) {
      messageApi.error('加载单集列表失败: ' + (err.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (voiceId) => {
    try {
      await window.electronAPI.deleteVoice(podcast.id, voiceId)
      messageApi.success('删除成功')
      loadEpisodes(page)
    } catch (err) {
      messageApi.error('删除失败: ' + (err.message || '未知错误'))
    }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    try {
      await window.electronAPI.deleteVoice(podcast.id, [...selectedIds])
      messageApi.success(`已删除 ${selectedIds.size} 个单集`)
      loadEpisodes(page)
    } catch (err) {
      messageApi.error('批量删除失败: ' + (err.message || '未知错误'))
    }
  }

  const handleEdit = (ep) => {
    setEditingEp(ep)
    setEditForm({
      name: ep.name,
      description: ep.description || '',
      privacy: ep.status === 'private',
      coverUrl: ep.coverUrl || '',
      coverImgId: ep.coverImgId || '',
    })
  }

  const handleSaveEdit = async () => {
    try {
      const updates = {}
      if (editForm.name !== editingEp.name) updates.name = editForm.name
      if (editForm.description !== (editingEp.description || '')) updates.description = editForm.description
      const newPrivacy = editForm.privacy
      const oldPrivacy = editingEp.status === 'private'
      if (newPrivacy !== oldPrivacy) updates.privacy = newPrivacy
      if (editForm.coverImgId && editForm.coverImgId !== (editingEp.coverImgId || '')) {
        updates.coverImgId = editForm.coverImgId
      }

      if (Object.keys(updates).length === 0) {
        setEditingEp(null)
        return
      }

      await window.electronAPI.updateVoice(editingEp.id, updates)
      messageApi.success('修改成功')
      setEditingEp(null)
      loadEpisodes(page)
    } catch (err) {
      messageApi.error('修改失败: ' + (err.message || '未知错误'))
    }
  }

  const selectAndUploadCover = async () => {
    const paths = await window.electronAPI.selectCoverFiles()
    if (!paths || paths.length === 0) return null
    const base64 = await window.electronAPI.readImageBase64(paths[0])
    if (!base64) { messageApi.error('读取图片失败'); return null }

    messageApi.loading('正在上传封面...')
    const result = await window.electronAPI.uploadCover(base64, 'cover.jpg')
    if (!result.picId) { messageApi.error('封面上传失败'); return null }
    return result.picId
  }

  const handleChangeCover = async (ep) => {
    try {
      const picId = await selectAndUploadCover()
      if (!picId) return

      await window.electronAPI.updateVoice(ep.id, { coverImgId: picId })
      messageApi.success('封面修改成功')
      loadEpisodes(page)
    } catch (err) {
      messageApi.error('修改封面失败: ' + (err.message || '未知错误'))
    }
  }

  const handleBatchChangeCover = async () => {
    if (selectedIds.size === 0) return
    try {
      const picId = await selectAndUploadCover()
      if (!picId) return

      let success = 0
      for (const id of selectedIds) {
        try {
          await window.electronAPI.updateVoice(id, { coverImgId: picId })
          success++
        } catch {}
      }
      messageApi.success(`已修改 ${success} 个单集的封面`)
      loadEpisodes(page)
    } catch (err) {
      messageApi.error('批量修改封面失败: ' + (err.message || '未知错误'))
    }
  }

  const handleTogglePrivacy = async (ep) => {
    try {
      const newPrivacy = ep.status !== 'private'
      await window.electronAPI.updateVoice(ep.id, { privacy: newPrivacy })
      messageApi.success(newPrivacy ? '已设为私密' : '已设为公开')
      loadEpisodes(page)
    } catch (err) {
      messageApi.error('修改失败: ' + (err.message || '未知错误'))
    }
  }

  const handleBatchTogglePrivacy = async (makePrivate) => {
    if (selectedIds.size === 0) return
    let success = 0
    for (const id of selectedIds) {
      try {
        await window.electronAPI.updateVoice(id, { privacy: makePrivate })
        success++
      } catch {}
    }
    messageApi.success(`已将 ${success} 个单集设为${makePrivate ? '私密' : '公开'}`)
    loadEpisodes(page)
  }

  const handleViewDetail = async (ep) => {
    setDetailLoading(true)
    setDetailEp(ep)
    try {
      const detail = await window.electronAPI.getVoiceDetail(ep.id)
      setDetailEp({ ...ep, ...detail })
    } catch (err) {
      messageApi.error('获取详情失败')
    } finally {
      setDetailLoading(false)
    }
  }

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === episodes.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(episodes.map(ep => ep.id)))
    }
  }

  const handleDownloadCover = async (url, name) => {
    if (!url) { messageApi.error('没有可下载的封面'); return }
    try {
      const result = await window.electronAPI.downloadImage(url, name || 'cover.jpg')
      if (result?.success) messageApi.success('封面已保存')
    } catch (err) {
      messageApi.error('下载封面失败: ' + (err.message || '未知错误'))
    }
  }

  // 移动到指定位置
  const handleMoveToPosition = (fromIndex, toPos) => {
    const toIndex = Math.max(0, Math.min(toPos - 1, episodes.length - 1))
    if (fromIndex === toIndex) return
    const newList = [...episodes]
    const [moved] = newList.splice(fromIndex, 1)
    newList.splice(toIndex, 0, moved)
    setEpisodes(newList)
  }

  const formatDuration = (ms) => {
    if (!ms) return '-'
    const totalSec = Math.floor(ms / 1000)
    const min = Math.floor(totalSec / 60)
    const sec = totalSec % 60
    return `${min}:${String(sec).padStart(2, '0')}`
  }

  return (
    <div>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>管理单集 - {podcast?.name}</Title>
        </Space>
        <Button icon={<ReloadOutlined />} onClick={() => loadEpisodes(page)} loading={loading}>刷新</Button>
      </div>

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <Card size="small" style={{ marginBottom: 12, background: '#f0f5ff' }}>
          <Space>
            <Text strong>已选 {selectedIds.size} 项</Text>
            <Button size="small" icon={<PictureOutlined />} onClick={handleBatchChangeCover}>批量修改封面</Button>
            <Button size="small" icon={<LockOutlined />} onClick={() => handleBatchTogglePrivacy(true)}>批量设为私密</Button>
            <Button size="small" icon={<UnlockOutlined />} onClick={() => handleBatchTogglePrivacy(false)}>批量设为公开</Button>
            <Popconfirm
              title={`确定删除 ${selectedIds.size} 个单集？`}
              description="删除后不可恢复"
              onConfirm={handleBatchDelete}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button size="small" danger icon={<DeleteOutlined />}>批量删除</Button>
            </Popconfirm>
            <Button size="small" type="link" onClick={() => setSelectedIds(new Set())}>取消选择</Button>
          </Space>
        </Card>
      )}

      {/* 表头 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '40px 60px 1fr 80px 80px 160px 200px',
        gap: 8, padding: '8px 12px', background: '#fafafa',
        borderRadius: '8px 8px 0 0', border: '1px solid #f0f0f0',
        fontWeight: 600, fontSize: 13,
      }}>
        <Checkbox
          checked={selectedIds.size === episodes.length && episodes.length > 0}
          indeterminate={selectedIds.size > 0 && selectedIds.size < episodes.length}
          onChange={toggleSelectAll}
        />
        <span>位置</span>
        <span>名称</span>
        <span>时长</span>
        <span>状态</span>
        <span>发布时间</span>
        <span>操作</span>
      </div>

      {/* 列表 */}
      {episodes.map((ep, index) => (
        <div
          key={ep.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '40px 60px 1fr 80px 80px 160px 200px',
            gap: 8, padding: '8px 12px',
            background: index % 2 === 0 ? '#fff' : '#fafafa',
            border: '1px solid #f0f0f0', borderTop: 'none',
            alignItems: 'center',
          }}
        >
          <Checkbox checked={selectedIds.has(ep.id)} onChange={() => toggleSelect(ep.id)} />
          <InputNumber
            min={1}
            max={episodes.length}
            value={index + 1}
            onChange={(val) => { if (val) handleMoveToPosition(index, val) }}
            size="small"
            style={{ width: 50 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {ep.coverUrl ? (
              <Image src={ep.coverUrl} width={32} height={32} style={{ borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} preview={false} />
            ) : (
              <div style={{ width: 32, height: 32, borderRadius: 4, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <SoundOutlined style={{ color: '#bbb', fontSize: 14 }} />
              </div>
            )}
            <Text ellipsis style={{ flex: 1 }}>{ep.name}</Text>
          </div>
          <span style={{ fontSize: 13 }}>{formatDuration(ep.duration)}</span>
          <Tag color={STATUS_MAP[ep.status]?.color || 'green'} style={{ fontSize: 11 }}>
            {STATUS_MAP[ep.status]?.text || '公开'}
          </Tag>
          <span style={{ fontSize: 12, color: '#999' }}>
            {ep.createTime ? new Date(ep.createTime).toLocaleString('zh-CN') : '-'}
          </span>
          <Space size={2}>
            <Tooltip title="修改封面"><Button type="text" size="small" icon={<PictureOutlined />} onClick={() => handleChangeCover(ep)} /></Tooltip>
            <Tooltip title="编辑"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(ep)} /></Tooltip>
            <Tooltip title={ep.status === 'private' ? '设为公开' : '设为私密'}>
              <Button type="text" size="small" icon={ep.status === 'private' ? <UnlockOutlined /> : <LockOutlined />} onClick={() => handleTogglePrivacy(ep)} />
            </Tooltip>
            <Popconfirm title="确定删除？" onConfirm={() => handleDelete(ep.id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        </div>
      ))}

      {episodes.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无单集</div>
      )}

      {total > pageSize && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, padding: '0 12px' }}>
          <Text type="secondary">共 {total} 个单集</Text>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger={false}
            showQuickJumper
            showTotal={(t) => `共 ${t} 个`}
            onChange={(p) => loadEpisodes(p)}
          />
        </div>
      )}

      {/* 编辑弹窗 */}
      <Modal
        title="编辑单集"
        open={!!editingEp}
        onCancel={() => setEditingEp(null)}
        onOk={handleSaveEdit}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text strong>名称</Text>
            <Input value={editForm.name} onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))} style={{ marginTop: 4 }} />
          </div>
          <div>
            <Text strong>简介</Text>
            <TextArea value={editForm.description} onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))} rows={4} style={{ marginTop: 4 }} />
          </div>
          <div>
            <Text strong>封面</Text>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
              {editForm.coverUrl ? (
                <Image
                  src={editForm.coverUrl}
                  width={80}
                  style={{ borderRadius: 4 }}
                  preview={{
                    toolbarRender: (originalNode) => (
                      <>
                        {originalNode}
                        <DownloadOutlined
                          className="ant-image-preview-toolbar-action"
                          onClick={() => handleDownloadCover(editForm.coverUrl, `cover_${editingEp?.id || 'podcast'}.jpg`)}
                        />
                      </>
                    ),
                  }}
                />
              ) : (
                <div style={{ width: 80, height: 80, borderRadius: 4, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PictureOutlined style={{ fontSize: 24, color: '#bbb' }} />
                </div>
              )}
              <Button
                icon={<PictureOutlined />}
                onClick={async () => {
                  const picId = await selectAndUploadCover()
                  if (picId) {
                    setEditForm(prev => ({ ...prev, coverImgId: picId, coverUrl: '' }))
                    messageApi.success('封面已上传，保存后生效')
                  }
                }}
              >
                更换封面
              </Button>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text>设为私密</Text>
            <Switch checked={editForm.privacy} onChange={(v) => setEditForm(prev => ({ ...prev, privacy: v }))} />
          </div>
        </Space>
      </Modal>

      {/* 详情弹窗 */}
      <Modal
        title="单集详情"
        open={!!detailEp}
        onCancel={() => setDetailEp(null)}
        footer={null}
        width={600}
      >
        {detailEp && (
          <Descriptions column={1} size="small" loading={detailLoading}>
            <Descriptions.Item label="名称">{detailEp.name}</Descriptions.Item>
            <Descriptions.Item label="ID">{detailEp.id}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={STATUS_MAP[detailEp.status]?.color || 'green'}>{STATUS_MAP[detailEp.status]?.text || '公开'}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="时长">{formatDuration(detailEp.duration)}</Descriptions.Item>
            <Descriptions.Item label="发布时间">
              {detailEp.createTime ? new Date(detailEp.createTime).toLocaleString('zh-CN') : '-'}
            </Descriptions.Item>
            {detailEp.coverUrl && (
              <Descriptions.Item label="封面">
                <Image
                  src={detailEp.coverUrl}
                  width={120}
                  preview={{
                    toolbarRender: (originalNode) => (
                      <>
                        {originalNode}
                        <DownloadOutlined
                          className="ant-image-preview-toolbar-action"
                          onClick={() => handleDownloadCover(detailEp.coverUrl, `cover_${detailEp.id || 'episode'}.jpg`)}
                        />
                      </>
                    ),
                  }}
                />
              </Descriptions.Item>
            )}
            <Descriptions.Item label="简介">{detailEp.description || '无'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  )
}
