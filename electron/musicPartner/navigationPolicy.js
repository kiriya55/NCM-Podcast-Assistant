'use strict'

function isAllowedPartnerNavigation(rawUrl) {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && (
      url.hostname === 'music.163.com' || url.hostname.endsWith('.music.163.com')
    )
  } catch (_) {
    return false
  }
}

module.exports = { isAllowedPartnerNavigation }
