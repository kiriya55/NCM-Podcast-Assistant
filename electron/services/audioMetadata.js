/**
 * 从音频文件中提取元数据：封面图片 + ID3/M4A 标签（标题、歌手、专辑等）
 * 支持 MP3 (ID3v2) 和 M4A/AAC (ilst atom)
 */
const fs = require('fs')
const path = require('path')

// ==================== 公共接口 ====================

/**
 * 提取音频文件的封面和标签信息
 * @param {string} filePath
 * @returns {{ cover: { buffer, mime } | null, tags: object }}
 */
function extractAudioMetadata(filePath) {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.mp3' || ext === '.wav') {
    const buffer = readID3TagBuffer(filePath)
    return extractFromMP3(buffer)
  } else if (ext === '.m4a' || ext === '.aac' || ext === '.mp4') {
    const buffer = readTopLevelAtomBuffer(filePath, 'moov')
    if (!buffer) return { cover: null, tags: {} }
    return extractFromM4A(buffer)
  }

  const buffer = readID3TagBuffer(filePath)
  return extractFromMP3(buffer)
}

function readID3TagBuffer(filePath) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const header = Buffer.alloc(10)
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0)
    if (bytesRead < 10) return header.slice(0, bytesRead)
    if (header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) return header

    const tagSize = ((header[6] & 0x7F) << 21) |
                    ((header[7] & 0x7F) << 14) |
                    ((header[8] & 0x7F) << 7) |
                    (header[9] & 0x7F)
    const totalSize = Math.min(tagSize + 10, fs.fstatSync(fd).size)
    const buffer = Buffer.alloc(totalSize)
    header.copy(buffer, 0)
    if (totalSize > 10) {
      fs.readSync(fd, buffer, 10, totalSize - 10, 10)
    }
    return buffer
  } finally {
    fs.closeSync(fd)
  }
}

function readTopLevelAtomBuffer(filePath, atomName) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const fileSize = fs.fstatSync(fd).size
    let offset = 0
    const header = Buffer.alloc(16)

    while (offset < fileSize - 8) {
      fs.readSync(fd, header, 0, 8, offset)
      let atomSize = header.readUInt32BE(0)
      const atomType = header.slice(4, 8).toString('latin1')
      let headerSize = 8

      if (atomSize === 1) {
        fs.readSync(fd, header, 8, 8, offset + 8)
        const high = header.readUInt32BE(8)
        const low = header.readUInt32BE(12)
        atomSize = high * 0x100000000 + low
        headerSize = 16
      } else if (atomSize === 0) {
        atomSize = fileSize - offset
      }

      if (atomType === atomName) {
        const safeSize = Math.min(atomSize, fileSize - offset)
        const buffer = Buffer.alloc(safeSize)
        fs.readSync(fd, buffer, 0, safeSize, offset)
        return buffer
      }

      if (atomSize <= headerSize) break
      offset += atomSize
    }

    return null
  } finally {
    fs.closeSync(fd)
  }
}

// ==================== MP3 / ID3v2 ====================

function extractFromMP3(buffer) {
  let cover = null
  const tags = {}

  try {
    if (buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) {
      return { cover: null, tags: {} }
    }

    const version = buffer[3]
    const tagSize = ((buffer[6] & 0x7F) << 21) |
                    ((buffer[7] & 0x7F) << 14) |
                    ((buffer[8] & 0x7F) << 7) |
                    (buffer[9] & 0x7F)

    let offset = 10
    const endOffset = Math.min(10 + tagSize, buffer.length)

    while (offset < endOffset - 10) {
      let frameId, frameSize

      if (version === 2) {
        frameId = buffer.slice(offset, offset + 3).toString('ascii')
        if (!frameId.match(/^[A-Z0-9]{3}$/)) break
        frameSize = (buffer[offset + 3] << 16) | (buffer[offset + 4] << 8) | buffer[offset + 5]
        offset += 6
      } else {
        frameId = buffer.slice(offset, offset + 4).toString('ascii')
        if (!frameId.match(/^[A-Z0-9]{4}$/)) break
        if (version === 4) {
          frameSize = ((buffer[offset + 4] & 0x7F) << 21) |
                      ((buffer[offset + 5] & 0x7F) << 14) |
                      ((buffer[offset + 6] & 0x7F) << 7) |
                      (buffer[offset + 7] & 0x7F)
        } else {
          frameSize = (buffer[offset + 4] << 24) |
                      (buffer[offset + 5] << 16) |
                      (buffer[offset + 6] << 8) |
                      buffer[offset + 7]
        }
        offset += 8 + (version >= 3 ? 2 : 0)
      }

      if (frameSize <= 0 || frameSize > endOffset - offset) break

      // 文本帧解析
      if (version === 2) {
        // ID3v2.2 3字符帧ID
        const mappedId = id3v22ToId3v23(frameId)
        if (mappedId) {
          const text = parseTextFrame(buffer, offset, frameSize)
          if (text) {
            const key = id3FrameToTagKey(mappedId)
            if (key) tags[key] = text
          }
        }
        if (frameId === 'PIC') {
          cover = parseAPICFrame(buffer, offset, frameSize, version)
        }
      } else {
        // ID3v2.3/2.4
        if (isTextFrame(frameId)) {
          const text = parseTextFrame(buffer, offset, frameSize)
          if (text) {
            const key = id3FrameToTagKey(frameId)
            if (key) tags[key] = text
          }
        }
        if (frameId === 'APIC' && !cover) {
          cover = parseAPICFrame(buffer, offset, frameSize, version)
        }
      }

      offset += frameSize
    }
  } catch (e) {
    console.error('[Metadata] MP3 extraction error:', e.message)
  }

  return { cover, tags }
}

function isTextFrame(frameId) {
  return frameId.startsWith('T') && frameId !== 'TXXX' && frameId.length === 4
}

function parseTextFrame(buffer, offset, size) {
  try {
    const encoding = buffer[offset]
    const textStart = offset + 1
    const textEnd = offset + size
    let text

    if (encoding === 0) {
      // ISO-8859-1
      text = buffer.slice(textStart, textEnd).toString('latin1')
    } else if (encoding === 1) {
      // UTF-16 with BOM
      text = decodeUTF16(buffer.slice(textStart, textEnd))
    } else if (encoding === 2) {
      // UTF-16BE without BOM
      text = buffer.slice(textStart, textEnd).toString('utf16le')
    } else if (encoding === 3) {
      // UTF-8
      text = buffer.slice(textStart, textEnd).toString('utf-8')
    } else {
      text = buffer.slice(textStart, textEnd).toString('utf-8')
    }

    // 去除 null 和首尾空白
    return (text || '').replace(/\0/g, '').trim() || null
  } catch {
    return null
  }
}

function decodeUTF16(buf) {
  if (buf.length < 2) return ''
  // 检测 BOM
  if (buf[0] === 0xFF && buf[1] === 0xFE) {
    return buf.slice(2).toString('utf16le')
  } else if (buf[0] === 0xFE && buf[1] === 0xFF) {
    // UTF-16 BE — 手动反转字节序
    const swapped = Buffer.alloc(buf.length - 2)
    for (let i = 2; i < buf.length - 1; i += 2) {
      swapped[i - 2] = buf[i + 1]
      swapped[i - 1] = buf[i]
    }
    return swapped.toString('utf16le')
  }
  return buf.toString('utf16le')
}

function id3v22ToId3v23(id) {
  const map = {
    TT2: 'TIT2', TP1: 'TPE1', TP2: 'TPE2', TAL: 'TALB',
    TRK: 'TRCK', TYE: 'TDRC', TCO: 'TCON', TCM: 'TCOM',
    TPA: 'TPOS', TP3: 'TPE3', TP4: 'TPE4', TEN: 'TENC',
    TSS: 'TSSE', TOR: 'TDOR', TDAT: 'TDAT', TIME: 'TIME',
  }
  return map[id] || null
}

function id3FrameToTagKey(frameId) {
  const map = {
    TIT2: 'title',     // 标题
    TPE1: 'artist',    // 歌手/表演者
    TPE2: 'albumArtist', // 专辑艺术家
    TALB: 'album',     // 专辑
    TCOM: 'composer',  // 作曲
    TRCK: 'track',     // 曲目号
    TDRC: 'year',      // 年份
    TCON: 'genre',     // 流派
    TPOS: 'disc',      // 碟片号
    TPE3: 'conductor', // 指挥
    TENC: 'encodedBy', // 编码器
    TIT1: 'grouping',  // 分组
    TIT3: 'subtitle',  // 副标题
    TSST: 'setSubtitle',
  }
  return map[frameId] || null
}

// ==================== M4A / MP4 (ilst atom) ====================

function extractFromM4A(buffer) {
  let cover = null
  const tags = {}

  try {
    const moovOffset = findAtom(buffer, 'moov', 0)
    if (moovOffset === -1) return { cover: null, tags: {} }

    const moovSize = buffer.readUInt32BE(moovOffset)
    const moovEnd = moovOffset + moovSize

    // 在 moov 中找 meta (可能在 udta 下或直接在 moov 下)
    let pos = moovOffset + 8
    while (pos < moovEnd - 8) {
      const atomSize = buffer.readUInt32BE(pos)
      const atomType = readAtomType(buffer, pos + 4)

      if (atomType === 'udta') {
        const udtaEnd = pos + atomSize
        let upos = pos + 8
        while (upos < udtaEnd - 8) {
          const uSize = buffer.readUInt32BE(upos)
          const uType = readAtomType(buffer, upos + 4)
          if (uType === 'meta') {
            const result = parseM4AMeta(buffer, upos, uSize)
            if (result.cover) cover = result.cover
            Object.assign(tags, result.tags)
          }
          upos += uSize || 1
        }
      } else if (atomType === 'meta') {
        const result = parseM4AMeta(buffer, pos, atomSize)
        if (result.cover) cover = result.cover
        Object.assign(tags, result.tags)
      }

      pos += atomSize || 1
    }
  } catch (e) {
    console.error('[Metadata] M4A extraction error:', e.message)
  }

  return { cover, tags }
}

function parseM4AMeta(buffer, metaOffset, metaSize) {
  const metaEnd = metaOffset + metaSize
  let pos = metaOffset + 8

  // meta 是 full atom（含 version/flags 4 字节），但部分编码器省略这 4 字节
  // 通过检测前 4 字节是否全零来判断：全零说明是 version=0 + flags=0，否则是子 atom 的 size
  const maybeVersionFlags = buffer.readUInt32BE(pos)
  if (maybeVersionFlags === 0) {
    pos += 4 // 跳过 version/flags
  }

  while (pos < metaEnd - 8) {
    const atomSize = buffer.readUInt32BE(pos)
    const atomType = readAtomType(buffer, pos + 4)

    if (atomType === 'ilst') {
      return parseM4AIlst(buffer, pos, atomSize)
    }
    if (atomSize <= 0) break
    pos += atomSize
  }
  return { cover: null, tags: {} }
}

function parseM4AIlst(buffer, ilstOffset, ilstSize) {
  const ilstEnd = ilstOffset + ilstSize
  let pos = ilstOffset + 8
  let cover = null
  const tags = {}

  while (pos < ilstEnd - 8) {
    const atomSize = buffer.readUInt32BE(pos)
    const atomType = readAtomType(buffer, pos + 4)

    if (atomSize <= 0) break

    if (atomType === 'covr' && !cover) {
      cover = parseM4ACover(buffer, pos, atomSize)
    } else {
      const text = parseM4ATextItem(buffer, pos, atomSize)
      if (text) {
        const key = m4aAtomToTagKey(atomType)
        if (key) tags[key] = text
      }
    }

    pos += atomSize
  }

  return { cover, tags }
}

function parseM4ATextItem(buffer, itemOffset, itemSize) {
  try {
    const itemEnd = itemOffset + itemSize
    let pos = itemOffset + 8

    while (pos < itemEnd - 8) {
      const dSize = buffer.readUInt32BE(pos)
      const dType = buffer.slice(pos + 4, pos + 8).toString('ascii')

      if (dType === 'data' && dSize >= 16) {
        const typeIndicator = buffer.readUInt32BE(pos + 8)
        // type 0 = implicit (多数编码器实际也是 UTF-8), type 1 = UTF-8 text
        if (typeIndicator === 0 || typeIndicator === 1) {
          const text = buffer.slice(pos + 16, pos + dSize).toString('utf-8').replace(/\0/g, '').trim()
          if (text) return text
        }
      }
      pos += dSize || 1
    }
  } catch {}
  return null
}

function parseM4ACover(buffer, coverOffset, coverSize) {
  try {
    const coverEnd = coverOffset + coverSize
    let pos = coverOffset + 8

    while (pos < coverEnd - 8) {
      const dSize = buffer.readUInt32BE(pos)
      const dType = buffer.slice(pos + 4, pos + 8).toString('ascii')
      if (dType === 'data' && dSize > 16) {
        const typeIndicator = buffer.readUInt32BE(pos + 8)
        const imageData = buffer.slice(pos + 16, pos + dSize)
        if (imageData.length > 100) {
          let mime = 'image/jpeg'
          if (typeIndicator === 14) mime = 'image/png'
          else if (imageData[0] === 0x89 && imageData[1] === 0x50) mime = 'image/png'
          return { buffer: imageData, mime }
        }
      }
      pos += dSize || 1
    }
  } catch {}
  return null
}

// M4A atom 名称以 0xA9 开头（Apple 的 © 编码），toString('ascii') 会丢弃高位变为 ')'
// 使用 latin1 编码保留原始字节值，使 © 前缀能正确匹配 map
function readAtomType(buffer, offset) {
  return buffer.slice(offset, offset + 4).toString('latin1')
}

function m4aAtomToTagKey(atomType) {
  const map = {
    '©nam': 'title',
    '©ART': 'artist',
    'aART': 'albumArtist',
    '©alb': 'album',
    '©wrt': 'composer',
    '©gen': 'genre',
    'trkn': 'track',
    'disk': 'disc',
    '©day': 'year',
    '©too': 'encodedBy',
    '©grp': 'grouping',
    '©cmt': 'comment',
  }
  return map[atomType] || null
}

// ==================== APIC 帧解析 ====================

function parseAPICFrame(buffer, offset, size, version) {
  try {
    const encoding = buffer[offset]
    let pos = offset + 1

    let mime = ''
    while (pos < offset + size && buffer[pos] !== 0) {
      mime += String.fromCharCode(buffer[pos])
      pos++
    }
    pos++

    const picType = buffer[pos]
    pos++

    // 跳过 description
    if (version === 2) {
      while (pos < offset + size && buffer[pos] !== 0) pos++
      pos++
      if (encoding === 1) pos++
    } else {
      if (encoding === 1 || encoding === 2) {
        while (pos < offset + size - 1) {
          if (buffer[pos] === 0 && buffer[pos + 1] === 0) { pos += 2; break }
          pos += 2
        }
      } else {
        while (pos < offset + size && buffer[pos] !== 0) pos++
        pos++
      }
    }

    const imageBuffer = buffer.slice(pos, offset + size)
    if (imageBuffer.length < 100) return null

    let detectedMime = mime
    if (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8) detectedMime = 'image/jpeg'
    else if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50) detectedMime = 'image/png'
    if (!detectedMime) detectedMime = 'image/jpeg'

    return { buffer: imageBuffer, mime: detectedMime }
  } catch {
    return null
  }
}

// ==================== 工具函数 ====================

function findAtom(buffer, name, startOffset) {
  let offset = startOffset
  while (offset < buffer.length - 8) {
    const size = buffer.readUInt32BE(offset)
    const type = readAtomType(buffer, offset + 4)
    if (type === name) return offset
    if (size <= 0) break
    offset += size
  }
  return -1
}

module.exports = { extractAudioMetadata }
