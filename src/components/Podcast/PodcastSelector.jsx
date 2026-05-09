import React, { useState, useEffect } from 'react'
import { Card, Row, Col, Typography, Spin, Empty, Button, Tag, message, Result } from 'antd'
import { AudioOutlined, ReloadOutlined, RightOutlined, LoginOutlined } from '@ant-design/icons'

const { Text, Title, Paragraph } = Typography

export default function PodcastSelector({ onSelect, onReLogin, title }) {
  const [podcasts, setPodcasts] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [error, setError] = useState(null)
  const [messageApi, contextHolder] = message.useMessage()

  const fetchPodcasts = async () => {
    try {
      setLoading(true)
      setError(null)
      const list = await window.electronAPI.getPodcastList()
      setPodcasts(list)
    } catch (err) {
      const errMsg = err.message || '未知错误'
      // 检测是否是登录过期（400、301、cookie相关错误）
      if (errMsg.includes('400') || errMsg.includes('301') || errMsg.includes('登录') || errMsg.includes('cookie') || errMsg.includes('参数错误')) {
        setError('expired')
      } else {
        setError('other')
      }
      console.error('[PodcastSelector] fetchPodcasts error:', errMsg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPodcasts()
  }, [])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        {contextHolder}
        <Spin size="large" tip="正在加载播客列表..." />
      </div>
    )
  }

  // Cookie过期，提示重新登录
  if (error === 'expired') {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        {contextHolder}
        <Result
          status="warning"
          title="登录已过期"
          subTitle="你的网易云音乐登录凭证已失效，请重新扫码登录"
          extra={
            <Button type="primary" icon={<LoginOutlined />} onClick={onReLogin} size="large">
              重新登录
            </Button>
          }
        />
      </div>
    )
  }

  if (error === 'other') {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        {contextHolder}
        <Empty
          description="获取播客列表失败，请稍后重试"
        >
          <Button icon={<ReloadOutlined />} onClick={fetchPodcasts}>
            重新加载
          </Button>
        </Empty>
      </div>
    )
  }

  if (podcasts.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        {contextHolder}
        <Empty
          description={
            <span>
              未找到播客。请确认你已在网易云音乐创建了播客/电台。
              <br />
              <a href="https://music.163.com/#/dj" target="_blank" rel="noopener noreferrer">
                前往网易云播客 →
              </a>
            </span>
          }
        >
          <Button icon={<ReloadOutlined />} onClick={fetchPodcasts}>
            刷新列表
          </Button>
        </Empty>
      </div>
    )
  }

  const handleSelect = (podcast) => {
    setSelectedId(podcast.id)
    onSelect(podcast)
  }

  return (
    <div>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{title || '选择播客'}</Title>
          {!title && <Text type="secondary">选择要投稿的播客</Text>}
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchPodcasts}>
          刷新
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        {podcasts.map((podcast) => (
          <Col key={podcast.id} xs={24} sm={12} lg={8}>
            <Card
              className={`podcast-card ${selectedId === podcast.id ? 'selected' : ''}`}
              hoverable
              onClick={() => handleSelect(podcast)}
            >
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 8,
                    background: '#e6f4ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    overflow: 'hidden',
                  }}
                >
                  {podcast.picUrl ? (
                    <img src={podcast.picUrl} alt={podcast.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <AudioOutlined style={{ fontSize: 32, color: '#1677ff' }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 4 }}>
                    {podcast.name}
                  </Text>
                  {podcast.description && (
                    <Paragraph
                      type="secondary"
                      ellipsis={{ rows: 2 }}
                      style={{ marginBottom: 8, fontSize: 13 }}
                    >
                      {podcast.description}
                    </Paragraph>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Tag color="blue">{podcast.programCount || 0} 集</Tag>
                    <RightOutlined style={{ color: '#bbb' }} />
                  </div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  )
}
