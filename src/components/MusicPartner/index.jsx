import React, { useEffect, useState } from 'react'
import { Alert, Button, Card, Space, Spin, Tag, Typography } from 'antd'
import {
  CheckCircleOutlined,
  MobileOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'

const { Paragraph, Text, Title } = Typography

export default function MusicPartner({ onOpenWindow }) {
  const [loading, setLoading] = useState(false)
  const [opening, setOpening] = useState(false)
  const [userInfo, setUserInfo] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    verifyUser()
  }, [])

  const verifyUser = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.electronAPI.mpVerifyUser()
      if (res.success) {
        setUserInfo(res)
      } else {
        setUserInfo(null)
        setError(res.message)
      }
    } catch (err) {
      setUserInfo(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const openWindow = async () => {
    setOpening(true)
    try {
      await onOpenWindow()
    } catch (err) {
      setError(err.message)
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="music-partner-page">
      <div className="page-header">
        <div>
          <Title level={4} style={{ margin: 0 }}>音乐合伙人</Title>
          <Text type="secondary">这里作为控制台使用，H5 任务页保持独立手机窗口运行。</Text>
        </div>
        <div className="page-header-actions">
          <Button icon={<ReloadOutlined />} onClick={verifyUser} loading={loading}>
            刷新状态
          </Button>
          <Button type="primary" icon={<MobileOutlined />} onClick={openWindow} loading={opening}>
            打开/聚焦手机窗口
          </Button>
        </div>
      </div>

      {error && (
        <Alert type="warning" showIcon message="状态提示" description={error} style={{ marginBottom: 16 }} />
      )}

      <div className="music-partner-console">
        <Card>
          <div className="music-partner-status">
            <Space size="middle">
              {loading ? (
                <Spin />
              ) : userInfo ? (
                <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 24 }} />
              ) : (
                <SafetyCertificateOutlined style={{ color: '#faad14', fontSize: 24 }} />
              )}
              <div>
                <Text strong>{userInfo ? `已登录：${userInfo.nickname}` : '等待验证登录状态'}</Text>
                <div>
                  <Text type="secondary">
                    {userInfo ? `用户 ID：${userInfo.userId || '-'}` : '请先完成主程序登录，再打开音乐合伙人窗口。'}
                  </Text>
                </div>
              </div>
            </Space>
            <Tag color={userInfo ? 'green' : 'orange'}>
              {userInfo ? 'Cookie 可用' : '需要登录'}
            </Tag>
          </div>
        </Card>

        <Card className="music-partner-window-card">
          <div className="music-partner-phone-preview">
            <div className="music-partner-phone-speaker" />
            <div className="music-partner-phone-screen-preview">
              <MobileOutlined />
              <Text strong>独立手机窗口</Text>
              <Text type="secondary">按 H5 原本适配的尺寸运行</Text>
            </div>
          </div>
          <div className="music-partner-window-copy">
            <Title level={5}>为什么使用独立窗口？</Title>
            <Paragraph type="secondary">
              这个 H5 对手机 WebView 环境和尺寸很敏感，直接嵌到桌面页面会空白或布局异常。
              独立窗口可以保持接近手机小程序的运行方式，同时仍由主程序负责准备登录态、桥接脚本和网络代理。
            </Paragraph>
            <Space wrap>
              <Button type="primary" icon={<MobileOutlined />} onClick={openWindow} loading={opening}>
                打开/聚焦手机窗口
              </Button>
              <Button icon={<ReloadOutlined />} onClick={verifyUser} loading={loading}>
                重新验证登录
              </Button>
            </Space>
          </div>
        </Card>
      </div>
    </div>
  )
}
