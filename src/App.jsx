import React, { useState, useEffect, useCallback } from 'react'
import { ConfigProvider, Layout, Menu, Steps, message, App as AntApp } from 'antd'
import {
  LoginOutlined, AudioOutlined, CloudUploadOutlined,
  EditOutlined, SettingOutlined, UserOutlined, LogoutOutlined,
  UnorderedListOutlined, CustomerServiceOutlined,
} from '@ant-design/icons'
import QRCodeLogin from './components/Login/QRCodeLogin'
import PhoneLogin from './components/Login/PhoneLogin'
import PodcastSelector from './components/Podcast/PodcastSelector'
import BatchUpload from './components/Upload/BatchUpload'
import EpisodeEditor from './components/Editor/EpisodeEditor'
import APISettings from './components/Settings/APISettings'
import VoiceManager from './components/Manage/VoiceManager'
import MusicPartner from './components/MusicPartner'

const { Sider, Content } = Layout

function AppContent() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [userInfo, setUserInfo] = useState(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [selectedPodcast, setSelectedPodcast] = useState(null)
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [activeMenu, setActiveMenu] = useState('login')
  const [loginMethod, setLoginMethod] = useState('qr')
  const [managePodcast, setManagePodcast] = useState(null)
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    checkLogin()
  }, [])

  const checkLogin = async () => {
    try {
      const result = await window.electronAPI.checkLoginStatus()
      if (result.isLoggedIn) {
        setIsLoggedIn(true)
        setActiveMenu('podcast')
        try {
          const info = await window.electronAPI.getUserInfo()
          setUserInfo(info)
        } catch (err) {
          console.warn('[App] 获取用户信息失败:', err.message)
        }
      }
    } catch (err) {
      console.warn('[App] 检查登录状态失败:', err.message)
    }
  }

  const handleLoginSuccess = async () => {
    try {
      const info = await window.electronAPI.getUserInfo()
      setUserInfo(info)
    } catch (err) {
      console.error('[App] 获取用户信息失败:', err)
    }
    setIsLoggedIn(true)
    setActiveMenu('podcast')
    messageApi.success('登录成功！')
  }

  // 统一的重置登录状态函数
  const resetToLogin = useCallback((msg) => {
    setIsLoggedIn(false)
    setUserInfo(null)
    setSelectedPodcast(null)
    setUploadedFiles([])
    setActiveMenu('login')
    setCurrentStep(0)
    if (msg) messageApi.warning(msg)
  }, [messageApi])

  const handleLogout = async () => {
    await window.electronAPI.logout()
    resetToLogin('已退出登录')
  }

  const handlePodcastSelect = (podcast) => {
    setSelectedPodcast(podcast)
    setActiveMenu('upload')
    setCurrentStep(1)
  }

  const handleManageSelect = (podcast) => {
    setManagePodcast(podcast)
    setActiveMenu('manage-list')
  }

  const handleUploadComplete = (files) => {
    setUploadedFiles(files)
    setActiveMenu('editor')
    setCurrentStep(2)
  }

  const handleSubmitComplete = () => {
    messageApi.success('所有单集提交成功！')
    setUploadedFiles([])
    setActiveMenu('podcast')
    setCurrentStep(0)
  }

  const handleOpenMusicPartner = async () => {
    try {
      return await window.electronAPI.openMusicPartner()
    } catch (err) {
      messageApi.error('打开音乐合伙人失败：' + err.message)
      throw err
    }
  }

  const menuItems = [
    ...(isLoggedIn
      ? [
          { key: 'podcast', icon: <AudioOutlined />, label: '选择播客' },
          { key: 'upload', icon: <CloudUploadOutlined />, label: '上传音频', disabled: !selectedPodcast },
          { key: 'editor', icon: <EditOutlined />, label: '编辑信息', disabled: uploadedFiles.length === 0 },
          { type: 'divider' },
          { key: 'manage', icon: <UnorderedListOutlined />, label: '管理播客' },
          { key: 'music-partner', icon: <CustomerServiceOutlined />, label: '音乐合伙人' },
        ]
      : [
          { key: 'login', icon: <LoginOutlined />, label: '登录' },
        ]),
    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
  ]

  const renderContent = () => {
    switch (activeMenu) {
      case 'login':
        return (
          <div>
            <Steps current={0} items={[{ title: '登录' }, { title: '选择播客' }, { title: '上传音频' }, { title: '编辑提交' }]} style={{ marginBottom: 32 }} />
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <Menu
                mode="horizontal"
                selectedKeys={[loginMethod]}
                items={[
                  { key: 'qr', label: '扫码登录' },
                  { key: 'phone', label: '手机验证码登录' },
                ]}
                onClick={({ key }) => setLoginMethod(key)}
                style={{ display: 'inline-flex', border: 'none' }}
              />
            </div>
            {loginMethod === 'qr' ? (
              <QRCodeLogin onLoginSuccess={handleLoginSuccess} />
            ) : (
              <PhoneLogin onLoginSuccess={handleLoginSuccess} />
            )}
          </div>
        )
      case 'podcast':
        return (
          <div>
            <Steps current={0} items={[{ title: '选择播客' }, { title: '上传音频' }, { title: '编辑信息' }, { title: '提交' }]} style={{ marginBottom: 32 }} />
            <PodcastSelector onSelect={handlePodcastSelect} onReLogin={() => resetToLogin('登录已过期，请重新扫码')} />
          </div>
        )
      case 'upload':
        return (
          <div>
            <Steps
              current={1}
              items={[
                { title: '选择播客', description: selectedPodcast?.name },
                { title: '上传音频' },
                { title: '编辑信息' },
                { title: '提交' },
              ]}
              style={{ marginBottom: 32 }}
            />
            <BatchUpload podcast={selectedPodcast} onComplete={handleUploadComplete} />
          </div>
        )
      case 'editor':
        return (
          <div>
            <Steps
              current={2}
              items={[
                { title: '选择播客', description: selectedPodcast?.name },
                { title: '上传音频', description: `${uploadedFiles.length}个文件` },
                { title: '编辑信息' },
                { title: '提交' },
              ]}
              style={{ marginBottom: 32 }}
            />
            <EpisodeEditor podcast={selectedPodcast} files={uploadedFiles} onComplete={handleSubmitComplete} />
          </div>
        )
      case 'settings':
        return <APISettings />
      case 'music-partner':
        return <MusicPartner onOpenWindow={() => window.electronAPI.openMusicPartnerWindow()} />
      case 'manage':
        return (
          <PodcastSelector
            onSelect={handleManageSelect}
            onReLogin={() => resetToLogin('登录已过期，请重新登录')}
            title="选择要管理的播客"
          />
        )
      case 'manage-list':
        return (
          <VoiceManager
            podcast={managePodcast}
            onBack={() => {
              setManagePodcast(null)
              setActiveMenu('manage')
            }}
          />
        )
      default:
        return null
    }
  }

  return (
    <Layout className="app-shell">
      {contextHolder}
      <Sider width={216} theme="light" className="app-sidebar">
        <div className="app-brand">
          <AudioOutlined className="app-brand-icon" />
          <span className="app-brand-title">网易云播客投稿助手</span>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[activeMenu]}
          items={menuItems}
          onClick={({ key }) => setActiveMenu(key)}
          style={{ borderRight: 'none' }}
        />
        {isLoggedIn && userInfo && (
          <div className="app-user-panel">
            <div className="app-user-row">
              <UserOutlined />
              <span className="app-user-name">
                {userInfo.nickname}
              </span>
            </div>
            <div
              onClick={handleLogout}
              className="app-logout"
            >
              <LogoutOutlined />
              <span>退出登录</span>
            </div>
          </div>
        )}
      </Sider>
      <Layout>
        <Content className="app-content">
          <div className="app-content-panel">
            {renderContent()}
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}

function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
        },
      }}
    >
      <AntApp>
        <AppContent />
      </AntApp>
    </ConfigProvider>
  )
}

export default App
