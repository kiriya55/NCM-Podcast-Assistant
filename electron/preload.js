const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 获取拖拽文件的真实路径（Electron 33+ File.path 已废弃）
  getFilePath: (file) => webUtils.getPathForFile(file),
  // 登录相关
  getQRKey: () => ipcRenderer.invoke('get-qr-key'),
  getQRCode: (key) => ipcRenderer.invoke('get-qr-code', key),
  checkQRLogin: (key) => ipcRenderer.invoke('check-qr-login', key),
  sendCaptcha: (phone) => ipcRenderer.invoke('send-captcha', phone),
  verifyCaptcha: (phone, captcha) => ipcRenderer.invoke('verify-captcha', phone, captcha),
  checkLoginStatus: () => ipcRenderer.invoke('check-login-status'),
  logout: () => ipcRenderer.invoke('logout'),
  getUserInfo: () => ipcRenderer.invoke('get-user-info'),

  // 播客相关
  getPodcastList: () => ipcRenderer.invoke('get-podcast-list'),
  getEpisodeList: (programId) => ipcRenderer.invoke('get-episode-list', programId),
  getEpisodeListPaged: (programId, page, pageSize) => ipcRenderer.invoke('get-episode-list-paged', programId, page, pageSize),

  // 上传相关
  uploadAudio: (programId, filePath, metadata) => ipcRenderer.invoke('upload-audio', programId, filePath, metadata),
  submitEpisode: (programId, episodeData) => ipcRenderer.invoke('submit-episode', programId, episodeData),
  uploadBatch: (programId, fileList) => ipcRenderer.invoke('upload-batch', programId, fileList),

  // 文件选择
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectCoverFiles: () => ipcRenderer.invoke('select-cover-files'),

  // 封面相关
  extractCover: (filePath) => ipcRenderer.invoke('extract-cover', filePath),
  batchExtractCovers: (filePaths) => ipcRenderer.invoke('batch-extract-covers', filePaths),
  uploadCover: (imageBufferBase64, fileName) => ipcRenderer.invoke('upload-cover', imageBufferBase64, fileName),
  updateVoiceCover: (voiceId, coverImgId, voiceListId) => ipcRenderer.invoke('update-voice-cover', voiceId, coverImgId, voiceListId),
  updatePodcastCover: (voiceListId, coverImgId) => ipcRenderer.invoke('update-podcast-cover', voiceListId, coverImgId),
  updateVoice: (voiceId, updates) => ipcRenderer.invoke('update-voice', voiceId, updates),
  deleteVoice: (voiceListId, voiceIds) => ipcRenderer.invoke('delete-voice', voiceListId, voiceIds),
  getVoiceDetail: (voiceId) => ipcRenderer.invoke('get-voice-detail', voiceId),
  readImageBase64: (filePath) => ipcRenderer.invoke('read-image-base64', filePath),
  downloadImage: (url, filename) => ipcRenderer.invoke('download-image', url, filename),

  // 音频标签提取
  batchExtractTags: (filePaths) => ipcRenderer.invoke('batch-extract-tags', filePaths),
  batchExtractMetadata: (filePaths) => ipcRenderer.invoke('batch-extract-metadata', filePaths),

  // LLM相关
  parseWithLLM: (text, template) => ipcRenderer.invoke('parse-with-llm', text, template),

  // 音乐合伙人
  openMusicPartner: () => ipcRenderer.invoke('open-music-partner'),
  openMusicPartnerWindow: () => ipcRenderer.invoke('open-music-partner-window'),
  mpVerifyUser: () => ipcRenderer.invoke('mp-verify-user'),
  mpRunAllTasks: (scoreStrategy) => ipcRenderer.invoke('mp-run-all-tasks', scoreStrategy),
  onMpProgress: (callback) => {
    ipcRenderer.on('mp-progress', (event, data) => callback(data))
  },
  removeMpProgressListener: () => {
    ipcRenderer.removeAllListeners('mp-progress')
  },

  // 设置相关
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // 事件监听
  onUploadProgress: (callback) => {
    ipcRenderer.on('upload-progress', (event, data) => callback(data))
  },
  removeUploadProgressListener: () => {
    ipcRenderer.removeAllListeners('upload-progress')
  },
})
