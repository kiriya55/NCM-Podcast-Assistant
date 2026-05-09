const fs = require('fs')
const path = require('path')
const nodeCrypto = require('crypto')
const fetch = require('node-fetch')
const { weapi } = require('./crypto')
const { extractAudioMetadata } = require('./audioMetadata')
const { BASE_URL, UA, NeteaseService } = require('./neteaseService')

class PodcastService extends NeteaseService {
  constructor(cookieStore) {
    super(cookieStore)
  }

  async getPodcastList() {
    console.log('[Podcast] getPodcastList called')
    this.ensureSession()

    const data = await this._postWeapi('/weapi/social/my/created/voicelist/v1', {
      limit: 100,
    })

    console.log('[Podcast] social/my/created/voicelist/v1 response code:', data.code)

    if (data.code === 200 && data.data) {
      const list = data.data.list || data.data.voicelists || data.data.data || []
      console.log('[Podcast] podcast count:', list.length)
      return list.map(item => ({
        id: item.voiceListId,
        name: item.voiceListName,
        description: item.description || '',
        picUrl: item.coverUrl || '',
        coverImgId: item.coverImgId || '',
        programCount: item.voiceCount || 0,
        createTime: item.createTime,
        fee: item.fee || false,
        privacy: item.privacy || false,
      }))
    }

    console.error('[Podcast] getPodcastList failed:', JSON.stringify(data))
    throw new Error('get podcast list failed: ' + (data.message || data.msg || JSON.stringify(data)))
  }

  async getEpisodeList(voiceListId) {
    console.log('[Podcast] getEpisodeList, voiceListId:', voiceListId)

    const pageSize = 100
    let offset = 0
    let allEpisodes = []
    let total = Infinity

    while (offset < total) {
      const data = await this._postWeapi('/weapi/voice/workbench/voices/by/voicelist', {
        voiceListId: parseInt(voiceListId),
        limit: pageSize,
        offset,
      })

      if (data.code !== 200 || !data.data) {
        if (offset === 0) {
          throw new Error('get episode list failed: ' + (data.message || data.msg || JSON.stringify(data)))
        }
        break
      }

      const list = data.data.list || data.data.voices || []
      total = data.data.total || 0
      allEpisodes = allEpisodes.concat(list.map(ep => this._mapEpisode(ep)))

      if (list.length < pageSize) break
      offset += pageSize
    }

    console.log('[Podcast] episode count:', allEpisodes.length, '(total:', total, ')')
    return allEpisodes
  }

  async getEpisodeListPaged(voiceListId, page = 1, pageSize = 50) {
    const offset = (page - 1) * pageSize
    const data = await this._postWeapi('/weapi/voice/workbench/voices/by/voicelist', {
      voiceListId: parseInt(voiceListId),
      limit: pageSize,
      offset,
    })

    if (data.code !== 200 || !data.data) {
      throw new Error('get episode list failed: ' + (data.message || data.msg || JSON.stringify(data)))
    }

    const list = data.data.list || data.data.voices || []
    const total = data.data.total || 0
    const episodes = list.map(ep => this._mapEpisode(ep))

    return { episodes, total, page, pageSize }
  }

  _mapEpisode(ep) {
    return {
      id: ep.voiceId,
      name: ep.voiceName,
      description: ep.description || '',
      duration: ep.duration || 0,
      createTime: ep.publishTime,
      status: ep.privacy ? 'private' : 'public',
      coverUrl: ep.coverUrl || '',
      coverImgId: ep.coverImgId || '',
      trackId: ep.trackId,
    }
  }

  async _allocateNOS(fileName, ext, bucket) {
    const csrf = this._csrf()
    const allocBody = `filename=${encodeURIComponent(fileName)}&ext=${ext}&type=other&bucket=${bucket}&local=false&nos_product=0`
    const allocRes = await fetch(`${BASE_URL}/api/nos/token/alloc?csrf_token=${csrf}`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://music.163.com/',
        'Origin': 'https://music.163.com',
        'Cookie': this._cookieString(),
      },
      body: allocBody,
    })
    const nosData = await allocRes.json()
    if (nosData.code !== 200) {
      throw new Error('获取上传凭证失败: ' + (nosData.message || JSON.stringify(nosData)))
    }
    return nosData.result || nosData.data || {}
  }

  // 图片专用的 NOS 分配（使用 weapi 加密，与浏览器一致）
  async _allocateNOSForImage() {
    const data = await this._postWeapi('/weapi/nos/token/alloc', {
      bucket: 'yyimgs',
      ext: 'temp',
      filename: 'temp',
      local: false,
      nos_product: 0,
      return_body: '{"code":200,"size":"$(ObjectSize)"}',
      type: 'image',
    })
    if (data.code !== 200) {
      throw new Error('获取图片上传凭证失败: ' + (data.message || JSON.stringify(data)))
    }
    return data.result || data.data || {}
  }

  // ========== 从音频文件提取封面和标签 ==========
  extractCoverFromAudio(filePath) {
    const { cover, tags } = extractAudioMetadata(filePath)
    if (!cover) return null
    return { buffer: cover.buffer, mime: cover.mime, size: cover.buffer.length }
  }

  extractAudioTags(filePath) {
    const { cover, tags } = extractAudioMetadata(filePath)
    return { tags, hasCover: !!cover }
  }

  extractFullMetadata(filePath) {
    return extractAudioMetadata(filePath)
  }

  // ========== 上传封面图片 ==========
  async uploadCoverImage(imageBuffer, fileName, mime = 'image/jpeg') {
    console.log('[Podcast] uploadCoverImage:', fileName, 'size:', imageBuffer.length, 'mime:', mime)

    // 使用图片专用分配接口（weapi 加密）
    const data = await this._allocateNOSForImage()
    const objectKey = data.objectKey
    const token = data.token
    const docId = data.docId ? String(data.docId) : ''

    // 上传图片到 NOS（POST 方式，与浏览器一致）
    const encodedKey = objectKey.replace(/\//g, '%2F')
    const uploadUrl = `https://nosup-hz1.127.net/yyimgs/${encodedKey}?offset=0&complete=true&version=1.0`
    console.log('[Podcast] Uploading cover to NOS:', uploadUrl)

    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'x-nos-token': token,
        'Content-Type': mime,
        'Referer': 'https://music.163.com/',
        'Origin': 'https://music.163.com',
      },
      body: imageBuffer,
    })

    if (res.status !== 200) {
      const resText = await res.text().catch(() => '')
      console.error('[Podcast] Cover upload failed:', res.status, resText)
      throw new Error('封面图片上传失败: HTTP ' + res.status)
    }

    // 裁剪图片（浏览器会执行这一步）
    if (docId) {
      try {
        const cropRes = await fetch(`https://music.163.com/upload/img/op?id=${docId}&op=0y0y600y600`, {
          method: 'PUT',
          headers: {
            'User-Agent': UA,
            'Referer': 'https://music.163.com/',
            'Origin': 'https://music.163.com',
            'Cookie': this._cookieString(),
          },
        })
        const cropData = await cropRes.json().catch(() => ({}))
        console.log('[Podcast] Image crop result:', cropData.code)
      } catch (e) {
        console.warn('[Podcast] Image crop failed (non-fatal):', e.message)
      }
    }

    console.log('[Podcast] Cover uploaded, docId:', docId, 'picId:', docId)

    return { success: true, picId: docId, objectKey }
  }

  async updateVoiceCover(voiceId, coverImgId, voiceListId) {
    // 如果没传 voiceListId，需要先查详情拿到它
    const radioId = voiceListId || (await this.getVoiceDetail(voiceId)).voiceListId

    const data = {
      total: false,
      coverImgId: String(coverImgId),
      radioId: parseInt(radioId),
      voiceList: String(voiceId),
      filterVoiceList: '',
      csrf_token: this._csrf(),
    }

    const { params, encSecKey } = weapi(data)
    const body = `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`
    const url = `https://interface.music.163.com/weapi/voice/workbench/voice/update/cover?csrf_token=${this._csrf()}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json, text/javascript',
          'Origin': 'https://music.163.com',
          'Referer': 'https://music.163.com/',
          'Cookie': this._cookieString(),
        },
        body,
        signal: controller.signal,
      })
      const result = await res.json()
      console.log('[Podcast] updateVoiceCover response:', JSON.stringify(result))
      if (result.code === 200) return { success: true, message: '封面修改成功' }
      throw new Error('修改封面失败: ' + (result.message || result.msg || JSON.stringify(result)))
    } finally {
      clearTimeout(timer)
    }
  }

  async updateVoice(voiceId, updates) {
    const detail = await this.getVoiceDetail(voiceId)

    // 以详情为基础，合并用户更新的字段，再补充必要的额外字段
    const payload = {
      ...detail,
      // 覆盖用户修改的字段
      voiceName: updates.name ?? detail.voiceName,
      name: updates.name ?? detail.name ?? detail.voiceName,
      description: updates.description ?? detail.description,
      coverImgId: String(updates.coverImgId ?? detail.coverImgId ?? ''),
      privacy: updates.privacy !== undefined ? (updates.privacy === true || updates.privacy === 'true') : detail.privacy,
      // 浏览器额外发送的字段
      id: parseInt(voiceId),
      publishType: 0,
      relatedSongs: '[]',
      composedSongs: detail.composedSongs || '',
      csrf_token: this._csrf(),
    }

    // 移除 null 值的只读字段（浏览器不会回传这些）
    delete payload.modules

    console.log('[Podcast] updateVoice payload keys:', Object.keys(payload).join(', '))

    const { params, encSecKey } = weapi(payload)
    const body = `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`
    const url = `https://interface.music.163.com/weapi/voice/workbench/voice/update?csrf_token=${this._csrf()}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Referer': 'https://music.163.com/',
          'Origin': 'https://music.163.com',
          'Cookie': this._cookieString(),
        },
        body,
        signal: controller.signal,
      })
      const data = await res.json()
      console.log('[Podcast] updateVoice response:', JSON.stringify(data))
      if (data.code === 200) return { success: true, message: '修改成功' }
      throw new Error('修改单集失败: ' + (data.message || data.msg || JSON.stringify(data)))
    } finally {
      clearTimeout(timer)
    }
  }

  async deleteVoice(voiceListId, voiceIds) {
    const ids = Array.isArray(voiceIds) ? voiceIds : [voiceIds]
    const data = await this._postWeapi('/weapi/content/voicelist/remove/voice', {
      voiceIds: JSON.stringify(ids),
      voiceListId: parseInt(voiceListId),
    }, 15000, 'https://interface.music.163.com')
    if (data.code === 200) return { success: true, message: '删除成功' }
    throw new Error('删除单集失败: ' + (data.message || data.msg || JSON.stringify(data)))
  }

  async getVoiceDetail(voiceId) {
    const data = await this._postWeapi('/weapi/voice/workbench/voice/detail', {
      id: String(voiceId),
    }, 15000, 'https://interface.music.163.com')
    console.log('[Podcast] getVoiceDetail response:', JSON.stringify(data).substring(0, 500))
    if (data.code === 200 && data.data) return data.data
    throw new Error('获取单集详情失败: ' + (data.message || data.msg || JSON.stringify(data)))
  }

  async getPodcastDetail(voiceListId) {
    const data = await this._postWeapi('/weapi/voice/workbench/voicelist/detail', {
      id: parseInt(voiceListId),
    })
    if (data.code === 200 && data.data) return data.data
    throw new Error('获取播客详情失败: ' + (data.message || data.msg || JSON.stringify(data)))
  }

  async updatePodcastCover(voiceListId, coverImgId) {
    const detail = await this.getPodcastDetail(voiceListId)
    const data = await this._postWeapi('/weapi/voice/workbench/voicelist/update', {
      voiceListId: parseInt(voiceListId),
      voiceListName: detail.voiceListName || '',
      description: detail.description || '',
      coverImgId: String(coverImgId),
      categoryId: detail.categoryId || 2001,
      secondCategoryId: detail.secondCategoryId || 6175,
      composedSongs: detail.composedSongs || [],
      privacy: detail.privacy || false,
      fee: detail.fee || false,
    })
    if (data.code === 200) return { success: true, message: '播客封面修改成功' }
    throw new Error('修改播客封面失败: ' + (data.message || data.msg || JSON.stringify(data)))
  }

  // ========== 上传音频文件 ==========
  async uploadAudio(voiceListId, filePath, metadata, onProgress) {
    if (!fs.existsSync(filePath)) throw new Error('文件不存在: ' + filePath)

    const fileName = path.basename(filePath)
    const fileSize = fs.statSync(filePath).size
    const ext = path.extname(fileName).replace('.', '').toLowerCase()

    console.log('[Podcast] uploadAudio:', fileName, 'size:', fileSize)

    if (onProgress) onProgress(10)

    // Step 1: 获取播客详情（获取 categoryId 等信息）
    const detailData = await this._postWeapi('/weapi/voice/workbench/voicelist/detail', {
      id: parseInt(voiceListId),
    })
    const podcastDetail = detailData.data || {}
    const categoryId = podcastDetail.categoryId || 2001
    const secondCategoryId = podcastDetail.secondCategoryId || 6175
    const podcastCoverImgId = podcastDetail.coverImgId || ''
    console.log('[Podcast] detail:', podcastDetail.voiceListName, 'cat:', categoryId, 'subcat:', secondCategoryId)

    if (onProgress) onProgress(15)

    // Step 2: 获取 NOS 上传 token（使用浏览器相同的接口）
    const nosResult = await this._allocateNOS(fileName, ext, 'ymusic')
    const objectKey = nosResult.objectKey
    const token = nosResult.token
    const bucket = nosResult.bucket || 'ymusic'
    const dfsId = nosResult.docId || ''

    console.log('[Podcast] objectKey:', objectKey, 'dfsId:', dfsId, 'bucket:', bucket)
    if (onProgress) onProgress(20)

    // Step 3: 上传文件到 NOS
    const uploadUrl = `https://nos.netease.com/${bucket}/${objectKey}`
    const nosRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'x-nos-token': token,
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(fileSize),
      },
      body: fs.createReadStream(filePath),
    })
    if (nosRes.status !== 200) throw new Error('NOS上传失败: HTTP ' + nosRes.status)
    if (onProgress) onProgress(60)

    // Step 4: PreCheck（使用和浏览器完全一致的 voiceData 结构）
    const dupkey = nodeCrypto.randomUUID()
    const voiceName = metadata.name || fileName.replace(/\.[^.]+$/, '')
    const description = metadata.description || ''

    const voiceData = JSON.stringify([{
      name: voiceName,
      autoPublish: false,
      autoPublishText: '',
      description: description,
      voiceListId: String(voiceListId),
      coverImgId: String(metadata.coverImgId || podcastCoverImgId || ''),
      dfsId: String(dfsId),
      categoryId: String(categoryId),
      secondCategoryId: String(secondCategoryId),
      composedSongs: [],
      privacy: String(metadata.isPrivate || false),
      publishTime: '0',
      orderNo: '1',
    }])

    const preCheckData = await this._postWeapi('/weapi/voice/workbench/voice/batch/upload/preCheck', {
      voiceData, dupkey,
    })
    console.log('[Podcast] PreCheck response:', preCheckData.code, preCheckData.msg || preCheckData.message || '')
    if (preCheckData.code !== 200) {
      console.error('[Podcast] PreCheck failed, full response:', JSON.stringify(preCheckData))
    }
    if (onProgress) onProgress(80)

    // Step 5: 发布单集
    const publishData = await this._postWeapi('/weapi/voice/workbench/voice/batch/upload/v2', {
      voiceData, dupkey,
    })
    console.log('[Podcast] Publish response:', publishData.code, publishData.msg || publishData.message || '')
    if (publishData.code !== 200) {
      console.error('[Podcast] Publish failed, full response:', JSON.stringify(publishData))
    }

    if (publishData.code === 200) {
      if (onProgress) onProgress(100)
      return { success: true, message: '单集上传成功', data: publishData.data }
    }

    throw new Error('发布单集失败: ' + (publishData.message || publishData.msg || JSON.stringify(publishData)))
  }

  async submitEpisode(voiceListId, episodeData) {
    return await this.uploadAudio(voiceListId, episodeData.filePath, episodeData, () => {})
  }
}

module.exports = PodcastService
