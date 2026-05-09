import React, { useState, useEffect, useRef } from 'react'
import { Card, Spin, Alert, Typography, Button } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

const { Text, Title } = Typography

export default function QRCodeLogin({ onLoginSuccess }) {
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [status, setStatus] = useState('loading')
  const [statusText, setStatusText] = useState('正在获取二维码...')
  const [errorMsg, setErrorMsg] = useState('')
  const timerRef = useRef(null)
  const onLoginSuccessRef = useRef(onLoginSuccess)
  const mountedRef = useRef(true)

  // 用 ref 保存最新的回调，避免 useCallback 依赖问题
  useEffect(() => {
    onLoginSuccessRef.current = onLoginSuccess
  }, [onLoginSuccess])

  // 组件卸载标记
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const cleanup = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const initQRCode = async () => {
    cleanup()

    if (!mountedRef.current) return
    setStatus('loading')
    setStatusText('正在获取二维码...')
    setErrorMsg('')
    setQrDataUrl('')

    try {
      const { unikey } = await window.electronAPI.getQRKey()
      if (!mountedRef.current) return

      const { qrDataUrl } = await window.electronAPI.getQRCode(unikey)
      if (!mountedRef.current) return

      setQrDataUrl(qrDataUrl)
      setStatus('ready')
      setStatusText('请使用网易云音乐APP扫码登录')

      // 开始轮询
      console.log('[QR] Starting poll, unikey:', unikey)
      timerRef.current = setInterval(async () => {
        if (!mountedRef.current) {
          cleanup()
          return
        }
        try {
          console.log('[QR] Polling...')
          const result = await window.electronAPI.checkQRLogin(unikey)
          console.log('[QR] Poll result:', JSON.stringify(result))

          if (!mountedRef.current) return

          if (result.success) {
            cleanup()
            setStatus('success')
            setStatusText('登录成功！')
            console.log('[QR] Calling onLoginSuccess...')
            try {
              await onLoginSuccessRef.current()
              console.log('[QR] onLoginSuccess completed')
            } catch (err) {
              console.error('[QR] onLoginSuccess error:', err)
            }
          } else if (result.code === 802) {
            setStatus('scanned')
            setStatusText('已扫码，请在手机上确认登录')
          } else if (result.code === 800) {
            cleanup()
            setStatus('expired')
            setStatusText('二维码已过期，请刷新')
          } else if (result.code === 8821) {
            cleanup()
            setStatus('error')
            setErrorMsg('触发网易云安全限制，请稍后再试')
            setStatusText('安全限制')
          }
        } catch (err) {
          console.error('[QR] Poll error:', err)
        }
      }, 2500)
    } catch (err) {
      if (!mountedRef.current) return
      setStatus('error')
      setErrorMsg(err.message || '获取二维码失败')
      setStatusText('获取二维码失败')
    }
  }

  // 只在组件挂载时执行一次
  useEffect(() => {
    initQRCode()
    return cleanup
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = () => {
    initQRCode()
  }

  const getStatusColor = () => {
    if (status === 'success') return 'success'
    if (status === 'error' || status === 'expired') return 'danger'
    return 'secondary'
  }

  return (
    <div className="login-container">
      <Title level={3}>扫码登录网易云音乐</Title>
      <Text type="secondary">使用网易云音乐APP扫描下方二维码</Text>

      <Card
        style={{ width: 340, textAlign: 'center', marginTop: 24 }}
        styles={{ body: { padding: 24 } }}
      >
        <div style={{ marginBottom: 16 }}>
          {status === 'loading' && (
            <div style={{ height: 256, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spin size="large" tip="正在生成二维码..." />
            </div>
          )}

          {status === 'error' && (
            <div style={{ height: 256, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <Alert
                message="错误"
                description={errorMsg}
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
              />
            </div>
          )}

          {(status === 'ready' || status === 'scanned') && qrDataUrl && (
            <div>
              <img
                src={qrDataUrl}
                alt="登录二维码"
                style={{
                  width: 256,
                  height: 256,
                  borderRadius: 8,
                  border: status === 'scanned' ? '3px solid #52c41a' : '1px solid #d9d9d9',
                }}
              />
            </div>
          )}

          {status === 'expired' && (
            <div
              style={{
                width: 256,
                height: 256,
                margin: '0 auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#fafafa',
                borderRadius: 8,
                border: '1px solid #d9d9d9',
              }}
            >
              <Text type="secondary" style={{ fontSize: 14 }}>
                二维码已过期
              </Text>
            </div>
          )}
        </div>

        <div style={{ minHeight: 24, marginBottom: 8 }}>
          <Text type={getStatusColor()}>
            {statusText}
          </Text>
        </div>

        {/* 刷新按钮：除了 loading 和 success 都显示 */}
        {status !== 'loading' && status !== 'success' && (
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
          >
            {status === 'ready' ? '重新获取' : '刷新二维码'}
          </Button>
        )}
      </Card>

      <div style={{ marginTop: 16 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          打开网易云音乐APP → 左上角菜单 → 扫一扫
        </Text>
      </div>
    </div>
  )
}
