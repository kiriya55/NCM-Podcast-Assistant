<p align="center">
<img src="https://github.com/kiriya55/NCM-Podcast-Assistant/blob/main/build/icon.png" alt="NCM-Podcast-Assistant Icon" width="128">
  <h1 align="center">网易云播客投稿助手</h1>
  <p align="center">
    通过GUI管理网易云播客&电脑完成音乐合伙人任务！
    <br />
  </p>
</p>
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

基于 Electron + React 的桌面端工具，用于向网易云音乐播客批量上传和管理音频单集。

## 功能特性

- **扫码/手机验证码登录** — 两种登录方式，安全便捷
- **批量上传** — 拖拽或选择多个音频文件（mp3/wav/m4a/aac/ogg/flac）
- **音频元数据提取** — 自动从 ID3v2/M4A 标签提取标题、歌手、专辑、封面
- **AI 智能填写** — 集成 OpenAI 兼容 API，从自然语言描述提取结构化歌曲信息
- **封面管理** — 从音频提取封面、设置统一封面、单独修改封面
- **播客管理** — 编辑单集信息、删除单集、设置隐私
- **音乐合伙人** — H5 页面电脑端实现

## 环境要求

- Node.js >= 18
- npm

## 快速开始

### 安装

```bash
# 克隆项目
git clone https://github.com/kiriya55/NCM-Podcast-Assistant.git
cd NCM-Podcast-Assistant

# 安装依赖
npm install
```

### 开发模式

```bash
npm run dev
```

启动 Vite 开发服务器 + Electron 窗口，支持热更新。

### 构建打包

```bash
npm run build
```

构建产物输出到 `release/` 目录，Windows 下生成 NSIS 安装包。

> 如需自定义图标，将 256x256 的 `icon.ico` 放到 `build/` 目录下。

## 使用说明

### 1. 登录

启动应用后，在左侧菜单选择「登录」：

- **扫码登录** — 用网易云音乐 APP 扫描二维码
- **手机验证码登录** — 输入手机号，获取验证码后登录

登录成功后，Cookie 会自动保存到本地，下次启动无需重新登录。

### 2. 上传音频

1. 左侧菜单选择「选择播客」，从列表中选择要投稿的播客
2. 进入「上传音频」，拖拽或点击选择音频文件
3. 系统自动提取音频中的封面和标签信息
4. 可设置统一封面或单独为每个文件设置封面
5. 点击「下一步：编辑信息」

### 3. 编辑信息

进入编辑页面后，每个单集可以：

- **手动填写** — 直接输入名称和介绍
- **从音频标签提取** — 自动填入 ID3 标签中的信息
- **AI 解析生成** — 粘贴自然语言描述，AI 自动提取结构化信息
- **从字段重新生成** — 根据结构化字段按模板重新生成名称和介绍

编辑完成后点击「全部提交」。

### 4. 管理播客

左侧菜单选择「管理播客」：

- 查看已有单集列表（分页浏览）
- 编辑单集名称、介绍、封面
- 设置单集公开/隐私状态
- 删除单集（支持批量删除）

### 5. 音乐合伙人

左侧菜单选择「音乐合伙人」：

- **可在电脑端模拟小窗口设备打开H5 页面** — 跨平台完成每日歌曲任务、点击喜欢和评分（目前版本为避免风险操作，禁用了歌曲推荐的相关功能）

### 6. 设置

左侧菜单选择「设置」：

- **OpenAI API Key** — 用于 AI 智能提取歌曲信息
- **API Base URL** — 可替换为 DeepSeek、通义千问等兼容 API
- **模型名称** — 默认 `gpt-4o`
- **System Prompt** — 自定义 AI 提取信息时的提示词
- **名称模板** — 控制单集名称格式，支持变量：
  - `{projectName}` — 企划/IP 名称
  - `{songTitle}` — 歌曲标题
  - `{artistName}` — 歌手
- **介绍模板** — 控制单集介绍格式，支持变量：
  - `{originalTitle}` — 原始标题
  - `{lyricist}` — 作词
  - `{composer}` — 作曲
  - `{arranger}` — 编曲
  - `{artistName}` — 歌手

模板和 Prompt 支持导出/导入为 JSON 文件。

## 项目结构

```
├── electron/
│   ├── main.js              # Electron 主进程
│   ├── preload.js            # 预加载脚本
│   └── services/
│       ├── auth.js           # 登录认证
│       ├── podcast.js        # 播客 API（上传/管理/封面）
│       ├── audioMetadata.js  # 音频元数据解析
│       ├── crypto.js         # 网易云 weapi 加密
│       ├── llm.js            # LLM 集成
│       ├── cookieStore.js    # Cookie 持久化
│       ├── settingsStore.js  # 设置持久化
│       └── musicPartner.js   # 音乐合伙人 API
├── src/
│   ├── App.jsx               # 主应用
│   ├── main.jsx              # React 入口
│   ├── styles/global.css     # 全局样式
│   └── components/
│       ├── Login/            # 登录组件
│       ├── Podcast/          # 播客选择
│       ├── Upload/           # 批量上传
│       ├── Editor/           # 单集编辑
│       ├── Manage/           # 播客管理
│       ├── Settings/         # API 设置
│       └── MusicPartner/     # 音乐合伙人
├── index.html
├── vite.config.js
└── package.json
```

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | Electron |
| 前端 | React 18 + Ant Design 5 |
| 构建 | Vite 5 + electron-builder |
| AI | OpenAI SDK（兼容 DeepSeek 等） |
| 存储 | electron-store |

## 免责声明

本项目仅供学习和研究用途。使用本工具时请遵守网易云音乐的服务条款。作者不对因使用本工具而产生的任何问题负责。

# 致谢

本项目大量使用了[NCMApiEnhanced相关项目](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)提供的API作为参考，在此致谢。

## License

MIT
