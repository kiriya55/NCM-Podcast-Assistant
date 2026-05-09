import React, { useState } from 'react'
import { Card, Input, Button, Typography, Space, message } from 'antd'
import { MobileOutlined, SafetyCertificateOutlined } from '@ant-design/icons'

const { Text, Title } = Typography

export default function PhoneLogin({ onLoginSuccess }) {
  const [phone, setPhone] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [captchaSent, setCaptchaSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [messageApi, contextHolder] = message.useMessage()

  const handleSendCaptcha = async () => {
    if (!phone || phone.length < 11) {
      messageApi.warning('请输入正确的手机号')
      return
    }
    try {
      setLoading(true)
      await window.electronAPI.sendCaptcha(phone)
      setCaptchaSent(true)
      setCountdown(60)
      messageApi.success('验证码已发送')
    } catch (err) {
      messageApi.error(err.message || '发送验证码失败')
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async () => {
    if (!phone || !captcha) {
      messageApi.warning('请输入手机号和验证码')
      return
    }
    try {
      setLoading(true)
      const result = await window.electronAPI.verifyCaptcha(phone, captcha)
      if (result.success) {
        messageApi.success(`欢迎回来，${result.nickname || '用户'}！`)
        onLoginSuccess()
      }
    } catch (err) {
      messageApi.error(err.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      {contextHolder}
      <Title level={3}>手机验证码登录</Title>
      <Text type="secondary">输入手机号，获取短信验证码登录</Text>

      <Card
        style={{ width: 400, marginTop: 24 }}
        styles={{ body: { padding: 32 } }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Input
            size="large"
            prefix={<MobileOutlined />}
            placeholder="请输入手机号"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
            maxLength={11}
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              size="large"
              prefix={<SafetyCertificateOutlined />}
              placeholder="请输入验证码"
              value={captcha}
              onChange={(e) => setCaptcha(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
              onPressEnter={handleLogin}
              style={{ flex: 1 }}
            />
            <Button
              size="large"
              onClick={handleSendCaptcha}
              loading={loading && !captchaSent}
              disabled={countdown > 0}
              style={{ minWidth: 120 }}
            >
              {countdown > 0 ? `${countdown}秒后重发` : '获取验证码'}
            </Button>
          </div>

          <Button
            type="primary"
            size="large"
            block
            onClick={handleLogin}
            loading={loading && captchaSent}
          >
            登录
          </Button>
        </Space>
      </Card>
    </div>
  )
}
