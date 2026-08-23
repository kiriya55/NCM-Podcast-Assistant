import React from 'react'
import { Alert, Button, Card, Progress, Space, Statistic, Tag, Typography } from 'antd'
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  MobileOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons'

const { Paragraph, Title, Text } = Typography

/**
 * Development-only primitive showcase.
 * Mounted only when import.meta.env.DEV && window.location.hash === '#design-system'.
 * Never linked from production navigation.
 */
export default function DesignSystemShowcase() {
  return (
    <div className="design-showcase">
      <div className="page-header">
        <div>
          <Title level={4} style={{ margin: 0 }}>Design System Showcase</Title>
          <Text type="secondary">Every primitive in each required state. Development only.</Text>
        </div>
      </div>

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card title="PageHeader / Title levels">
          <Title level={4} style={{ margin: 0 }}>Page title (20px / 650)</Title>
          <Title level={5} style={{ margin: '12px 0 0' }}>Section title (16px / 600)</Title>
          <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>Body 14px / 400. Caption 13px / 400.</Paragraph>
        </Card>

        <Card title="StatusCard — default / loading / warning">
          <Space size="large" wrap>
            <Space>
              <CheckCircleOutlined style={{ color: 'var(--success)', fontSize: 24 }} />
              <Text strong>已登录：demo</Text>
            </Space>
            <Space>
              <LoadingOutlined style={{ fontSize: 24 }} />
              <Text strong>验证中…</Text>
            </Space>
            <Space>
              <ExclamationCircleOutlined style={{ color: 'var(--warning)', fontSize: 24 }} />
              <Text strong>需要登录</Text>
            </Space>
            <Tag color="green">Cookie 可用</Tag>
            <Tag color="orange">需要登录</Tag>
          </Space>
        </Card>

        <Card title="ProgressCard — idle / running / paused / completed">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div>
              <Text strong>空闲</Text>
              <Progress percent={0} status="normal" />
            </div>
            <div>
              <Text strong>基础任务 3/5</Text>
              <Progress percent={60} status="active" />
            </div>
            <div>
              <Text strong>已暂停</Text>
              <Progress percent={35} status="exception" />
            </div>
            <div>
              <Text strong>已完成 20/20</Text>
              <Progress percent={100} status="success" />
            </div>
          </Space>
        </Card>

        <Card title="Statistic + Countdown (live region)">
          <Space size="large" wrap>
            <Statistic title="阶段" value="基础任务" />
            <Statistic title="进度" value="3 / 5" />
            <Statistic title="倒计时" value={12} suffix="秒" />
            <Statistic title="总评" value={4} />
          </Space>
        </Card>

        <Card title="ActionCluster — primary / secondary / disabled / loading">
          <Space wrap>
            <Button type="primary" icon={<PlayCircleOutlined />}>开始评分</Button>
            <Button icon={<MobileOutlined />}>打开/聚焦手机窗口</Button>
            <Button disabled>启动中…</Button>
            <Button type="primary" loading>提交中…</Button>
            <Button danger icon={<PauseCircleOutlined />}>已暂停 — 查看原因</Button>
          </Space>
        </Card>

        <Card title="AlertBanner — info / warning / error">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Alert type="info" showIcon message="准备就绪" description={'就绪，点击"开始评分"启动自动化流程'} />
            <Alert type="warning" showIcon message="已暂停" description="无法确认进入下一首歌曲，已停止后续点击。" />
            <Alert type="error" showIcon message="启动失败" description="手机窗口无法打开，请检查登录状态后重试。" />
          </Space>
        </Card>

        <Card title="PhonePreview (decorative)">
          <div className="music-partner-phone-preview">
            <div className="music-partner-phone-speaker" />
            <div className="music-partner-phone-screen-preview">
              <MobileOutlined />
              <Text strong>独立手机窗口</Text>
              <Text type="secondary">按 H5 原本适配的尺寸运行</Text>
            </div>
          </div>
        </Card>

        <Card title="StatusTag — all colors">
          <Space wrap>
            <Tag color="default">空闲</Tag>
            <Tag color="processing">准备中</Tag>
            <Tag color="blue">基础任务</Tag>
            <Tag color="cyan">拓展任务</Tag>
            <Tag color="orange">已暂停</Tag>
            <Tag color="red">已失败</Tag>
            <Tag color="green">已完成</Tag>
          </Space>
        </Card>

        <Card title="Focus + keyboard">
          <Space wrap>
            <Button type="primary">Primary focus</Button>
            <Button>Default focus</Button>
            <Button danger>Danger focus</Button>
          </Space>
          <Paragraph type="secondary" style={{ marginTop: 12 }}>
            按 Tab 键遍历；每个按钮应有可见的 focus ring。
          </Paragraph>
        </Card>
      </Space>
    </div>
  )
}
