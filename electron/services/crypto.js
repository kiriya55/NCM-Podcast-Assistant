/**
 * 网易云音乐 API 加密模块
 * 实现 weapi 加密方案
 */
const crypto = require('crypto')

const IV = Buffer.from('0102030405060708')
const PRESET_KEY = Buffer.from('0CoJUm6Qyw8W8jud')
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

// 网易云音乐 RSA 公钥 (hex encoded modulus, exponent=010001)
const RSA_MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7'
const RSA_EXPONENT = '010001'

function aesEncrypt(text, key) {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, IV)
  let encrypted = cipher.update(text, 'utf-8', 'base64')
  encrypted += cipher.final('base64')
  return encrypted
}

function rsaEncrypt(text) {
  const reversed = text.split('').reverse().join('')

  // Manual RSA: encrypted = text^exponent mod modulus
  const biText = BigInt('0x' + Buffer.from(reversed, 'utf-8').toString('hex'))
  const biMod = BigInt('0x' + RSA_MODULUS)
  const biExp = BigInt('0x' + RSA_EXPONENT)
  const biResult = modPow(biText, biExp, biMod)

  return biResult.toString(16).padStart(256, '0')
}

function modPow(base, exp, mod) {
  let result = 1n
  base = base % mod
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod
    }
    exp = exp / 2n
    base = (base * base) % mod
  }
  return result
}

function createSecretKey(size) {
  let key = ''
  for (let i = 0; i < size; i++) {
    key += BASE62[Math.floor(Math.random() * 62)]
  }
  return key
}

function weapi(obj) {
  const text = JSON.stringify(obj)
  const secretKey = createSecretKey(16)

  const firstPass = aesEncrypt(text, PRESET_KEY)
  const secondPass = aesEncrypt(firstPass, Buffer.from(secretKey))
  const encSecKey = rsaEncrypt(secretKey)

  return {
    params: secondPass,
    encSecKey: encSecKey,
  }
}

// === eapi 加解密 (用于 interface3.music.163.com) ===
// 标准格式：AES-128-ECB 加密 data，data = path + '-36cd479b6b5-' + body + '-36cd479b6b5-' + md5(header)
// header = 'nobody' + path + 'use' + body + 'md5forencrypt'
const EAPI_KEY = Buffer.from('e82ckenh8dichen8')

function eapiEncrypt(text, path) {
  // 构造 md5 摘要
  const message = 'nobody' + path + 'use' + text + 'md5forencrypt'
  const digest = crypto.createHash('md5').update(message).digest('hex')
  // 构造明文 data
  const data = path + '-36cd479b6b5-' + text + '-36cd479b6b5-' + digest
  const cipher = crypto.createCipheriv('aes-128-ecb', EAPI_KEY, null)
  let encrypted = cipher.update(data, 'utf-8', 'hex')
  encrypted += cipher.final('hex')
  return encrypted.toUpperCase()
}

function eapiDecrypt(cipherText) {
  const decipher = crypto.createDecipheriv('aes-128-ecb', EAPI_KEY, null)
  // 响应可能是 hex 编码或 base64 编码的密文
  let buf
  if (/^[0-9a-fA-F]+$/.test(cipherText) && cipherText.length % 2 === 0) {
    buf = Buffer.from(cipherText, 'hex')
  } else {
    buf = Buffer.from(cipherText, 'base64')
  }
  const decrypted = Buffer.concat([decipher.update(buf), decipher.final()])
  return decrypted.toString('utf-8')
}

function eapi(obj, path) {
  const text = JSON.stringify(obj)
  const params = eapiEncrypt(text, path)
  return { params }
}

module.exports = { weapi, aesEncrypt, eapi, eapiEncrypt, eapiDecrypt }
