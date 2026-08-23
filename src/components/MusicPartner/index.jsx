import React, { useEffect, useState } from 'react'
import { Alert, Button, Card, Modal, Input, Space, Spin, Tag, Typography, Progress, Statistic, Divider } from 'antd'
import {
  CheckCircleOutlined,
  MobileOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
  StarOutlined,
  ExclamationCircleOutlined,
  LockOutlined,
  UnlockOutlined,
} from '@ant-design/icons'
import { createUnlockPersistence } from './unlockStorage.mjs'

const UNLOCK_PASSWORD = import.meta.env.VITE_MP_PASSWORD || ''
const unlockPersistence = createUnlockPersistence(localStorage)

const { Paragraph, Text, Title } = Typography

const STATUS_LABELS = {
  idle: '待机',
  preparing: '准备中',
  daily: '每日评分中',
  extra: '拓展评分中',
  completed: '已完成',
  paused: '已暂停',
}

const STATUS_COLORS = {
  idle: 'default',
  preparing: 'processing',
  daily: 'processing',
  extra: 'processing',
  completed: 'success',
  paused: 'warning',
}

export default function MusicPartner({ onOpenWindow }) {
  const [loading, setLoading] = useState(false)
  const [opening, setOpening] = useState(false)
  const [userInfo, setUserInfo] = useState(null)
  const [error, setError] = useState(null)

  const [unlocked, setUnlocked] = useState(() => unlockPersistence.isUnlocked())
  const [unlockModalOpen, setUnlockModalOpen] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState(null)

  const [autoState, setAutoState] = useState({
    status: 'idle',
    phase: null,
    current: 0,
    total: 0,
    action: '',
    remainingMs: null,
    score: null,
    error: null,
    reasonCode: null,
    progressKnown: true,
  })
  const [starting, setStarting] = useState(false)

  const tryUnlock = () => {
    if (passwordInput === UNLOCK_PASSWORD) {
      setUnlocked(true)
      unlockPersistence.unlock()
      setUnlockModalOpen(false)
      setPasswordInput('')
      setPasswordError(null)
    } else {
      setPasswordError('密码错误，请重试')
    }
  }

  const handleLock = () => {
    setUnlocked(false)
    unlockPersistence.lock()
  }

  useEffect(() => {
    verifyUser()
    if (!unlocked) return
    window.electronAPI.mpAutomationStatus().then((state) => {
      if (state) setAutoState(state)
    }).catch(() => {})

    window.electronAPI.onMpAutomationState((state) => {
      setAutoState(state)
      setStarting(false)
    })

    return () => {
      window.electronAPI.removeMpAutomationStateListener()
    }
  }, [unlocked])

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

  const startAutomation = async () => {
    setStarting(true)
    setError(null)
    try {
      const result = await window.electronAPI.mpStartAutomation({ strategy: 0 })
      if (result && !result.success) {
        if (result.code === 'already-running') {
          setError('评分正在进行中，请先停止')
        } else {
          setError(result.reason || '启动失败')
        }
        setStarting(false)
      }
    } catch (err) {
      setError(err.message)
      setStarting(false)
    }
  }

  const cancelAutomation = async () => {
    try {
      await window.electronAPI.mpCancelAutomation('用户取消')
    } catch (err) {
      setError(err.message)
    }
  }

  const isRunning = autoState.status === 'preparing' || autoState.status === 'daily' || autoState.status === 'extra'
  const isPaused = autoState.status === 'paused'
  const isCompleted = autoState.status === 'completed'
  const isIdle = autoState.status === 'idle'

  const progressPercent = autoState.total > 0
    ? Math.round((autoState.current / autoState.total) * 100)
    : 0

  const phaseLabel = autoState.phase === 'daily' ? '每日歌曲' : autoState.phase === 'extra' ? '拓展歌曲' : ''
  const progressKnown = autoState.progressKnown !== false

  const formatRemaining = (ms) => {
    if (ms == null || ms <= 0) return null
    const seconds = Math.ceil(ms / 1000)
    if (seconds < 60) return `${seconds} 秒`
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${minutes} 分 ${secs} 秒`
  }

  return (
    <div className="music-partner-page">
      <div className="page-header">
        <div>
          <Title level={4} style={{ margin: 0 }}>音乐合伙人</Title>
          <Text type="secondary">神秘功能</Text>
        </div>
        <div className="page-header-actions">
          {UNLOCK_PASSWORD && (
            <Button
              icon={unlocked ? <UnlockOutlined /> : <LockOutlined />}
              onClick={() => (unlocked ? handleLock() : setUnlockModalOpen(true))}
            >
              {unlocked ? '锁定' : '解锁神秘功能'}
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={verifyUser} loading={loading}>
            刷新状态
          </Button>
          <Button icon={<MobileOutlined />} onClick={openWindow} loading={opening}>
            打开/聚焦手机窗口
          </Button>
        </div>
      </div>

      {error && (
        <Alert
          type="warning"
          showIcon
          message="状态提示"
          description={error}
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      <Modal
        title="解锁神秘功能"
        open={unlockModalOpen}
        onOk={tryUnlock}
        onCancel={() => {
          setUnlockModalOpen(false)
          setPasswordInput('')
          setPasswordError(null)
        }}
        okText="解锁"
        cancelText="取消"
      >
        <p>请输入密码以解锁神秘功能</p>
        <Input.Password
          value={passwordInput}
          onChange={(e) => setPasswordInput(e.target.value)}
          onPressEnter={tryUnlock}
          placeholder="请输入密码"
          autoFocus
        />
        {passwordError && (
          <div style={{ color: '#ff4d4f', marginTop: 8 }}>{passwordError}</div>
        )}
      </Modal>

      <div className="music-partner-console">
        {/* 登录状态卡片 */}
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

        {unlocked && (
        <Card
          title={
            <Space>
              <StarOutlined />
              <span>神秘功能</span>
              <Tag color={STATUS_COLORS[autoState.status]}>
                {STATUS_LABELS[autoState.status]}
              </Tag>
            </Space>
          }
          extra={
            <Space>
              {isRunning ? (
                <Button
                  danger
                  icon={<PauseCircleOutlined />}
                  onClick={cancelAutomation}
                >
                  停止
                </Button>
              ) : (
                <Button
                  type="primary"
                  size="large"
                  icon={starting ? <LoadingOutlined /> : <PlayCircleOutlined />}
                  onClick={startAutomation}
                  disabled={!userInfo || starting}
                  loading={starting}
                >
                  {isPaused ? '继续评分' : isCompleted ? '重新评分' : '开始评分'}
                </Button>
              )}
            </Space>
          }
        >
          {/* 进度区域 */}
          {(isRunning || isPaused) && (
            <div aria-live="polite" aria-atomic="false" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text strong>
                  {progressKnown ? `${phaseLabel} ${autoState.current + 1} / ${autoState.total}` : `${phaseLabel} · 评分中`}
                </Text>
                <Text type="secondary">{autoState.action}</Text>
              </div>
              <Progress
                percent={progressKnown ? progressPercent : 0}
                status={isPaused ? 'exception' : 'active'}
                showInfo={false}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {autoState.phase === 'daily' ? '每日歌曲评分阶段' : '拓展歌曲评分阶段'}
                </Text>
                {autoState.remainingMs != null && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    <ClockCircleOutlined /> {formatRemaining(autoState.remainingMs)}
                  </Text>
                )}
              </div>
            </div>
          )}

          {/* 评分展示区域 */}
          {autoState.score && (
            <div style={{ marginBottom: 16 }}>
              <Divider orientation="left" plain style={{ margin: '8px 0 12px' }}>
                <Text type="secondary">本首歌评分</Text>
              </Divider>
              <Space size="large" wrap>
                <Statistic
                  title="总评"
                  value={autoState.score.overall}
                  suffix="/ 5"
                  valueStyle={{ color: '#1677ff' }}
                />
                {autoState.score.parts && Object.entries(autoState.score.parts).map(([name, value]) => (
                  <Statistic
                    key={name}
                    title={name}
                    value={value}
                    suffix="/ 5"
                    valueStyle={{ fontSize: 20 }}
                  />
                ))}
              </Space>
            </div>
          )}

          {/* 错误信息 */}
          {isPaused && autoState.error && (
            <Alert
              type="error"
              showIcon
              icon={<ExclamationCircleOutlined />}
              message={autoState.reasonCode === 'submit-uncertain' ? '评分提交不确定' : '评分已暂停'}
              description={autoState.error}
              style={{ marginTop: 16 }}
            />
          )}

          {/* 完成信息 */}
          {isCompleted && (
            <Alert
              type="success"
              showIcon
              message="评分已完成"
              description="所有歌曲评分已提交，可关闭手机窗口"
              style={{ marginTop: 16 }}
            />
          )}

          {/* 待机提示 */}
          {isIdle && !userInfo && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <Text type="secondary">请先登录并打开音乐合伙人窗口</Text>
            </div>
          )}

          {isIdle && userInfo && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <Text type="secondary">就绪，点击"开始评分"启动自动化流程</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                每日 5 首 + 拓展 15 首，神秘功能逐首处理
              </Text>
            </div>
          )}
        </Card>
        )}

        {/* 窗口说明卡片 */}
        <Card className="music-partner-window-card">
          <div className="music-partner-phone-preview">
            <div className="music-partner-phone-speaker" />
            <div className="music-partner-phone-screen-preview">
              <MobileOutlined />
              <Text strong>独立手机窗口</Text>
              <Text type="secondary">按 H5 原本适配的<br /><span style={{ whiteSpace: 'nowrap' }}>尺寸运行</span></Text>
            </div>
          </div>
          <div className="music-partner-window-copy">
            <Title level={5}>为什么使用独立窗口？</Title>
            <Paragraph type="secondary">
              这个 H5 对手机 WebView 环境和尺寸很敏感，直接嵌到桌面页面会空白或布局异常。
              独立窗口可以保持接近手机小程序的运行方式，同时仍由主程序负责准备登录态、桥接脚本和网络代理。
            </Paragraph>
            <Space wrap>
              <Button icon={<MobileOutlined />} onClick={openWindow} loading={opening}>
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
