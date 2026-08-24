/**
 * Minimal, dependency-free Telegram Bot API client used as the hidden media
 * storage layer. The bot token and chat id are supplied from server-side
 * environment variables only; this module is never imported by the frontend.
 */

export class TelegramError extends Error {
  constructor(message, status, code) {
    super(message)
    this.name = 'TelegramError'
    this.status = status
    this.code = code
  }
}

function escapeFilename(name) {
  return String(name || 'file').replace(/[\r\n"]/g, '_')
}

export class TelegramBot {
  constructor({ token, chatId, apiBase }) {
    if (!token) throw new TelegramError('TELEGRAM_BOT_TOKEN is not configured', 500)
    if (!chatId) throw new TelegramError('TELEGRAM_STORAGE_CHAT_ID is not configured', 500)
    this.token = token
    this.chatId = chatId
    this.apiBase = apiBase.replace(/\/+$/, '')
  }

  get _endpoint() {
    return `${this.apiBase}/bot${this.token}`
  }

  downloadUrl(filePath) {
    return `${this.apiBase}/file/bot${this.token}/${filePath}`
  }

  async _call(method, params = {}) {
    const url = `${this._endpoint}/${method}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    })
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      throw new TelegramError(`Telegram returned a non-JSON response (HTTP ${res.status})`, res.status)
    }
    if (!json.ok) {
      throw new TelegramError(json.description || `Telegram ${method} failed`, res.status, json.error_code)
    }
    return json.result
  }

  async _upload(method, fields, file) {
    const url = `${this._endpoint}/${method}`
    const boundary = `----XsutraForm${randomToken()}`
    const chunks = []
    for (const [key, value] of Object.entries(fields)) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`))
    }
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${escapeFilename(file.filename)}"\r\n` +
      `Content-Type: ${file.contentType || 'application/octet-stream'}\r\n\r\n`
    ))
    chunks.push(file.buffer)
    chunks.push(Buffer.from('\r\n'))
    chunks.push(Buffer.from(`--${boundary}--\r\n`))
    const body = Buffer.concat(chunks)

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    })
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      throw new TelegramError(`Telegram returned a non-JSON response (HTTP ${res.status})`, res.status)
    }
    if (!json.ok) {
      throw new TelegramError(json.description || `Telegram ${method} failed`, res.status, json.error_code)
    }
    return json.result
  }

  async getMe() {
    return this._call('getMe')
  }

  async getFile(fileId) {
    return this._call('getFile', { file_id: fileId })
  }

  async deleteMessage(messageId) {
    return this._call('deleteMessage', { chat_id: String(this.chatId), message_id: Number(messageId) })
  }

  /**
   * Upload a media buffer to the private storage chat.
   * @returns normalized result: { messageId, fileId, thumbFileId, fileSize, width, height, duration, fileName }
   */
  async uploadMedia(mediaType, buffer, filename, mimeType, caption) {
    const method = mediaType === 'image' ? 'sendPhoto' : mediaType === 'video' ? 'sendVideo' : 'sendDocument'
    const fields = { chat_id: String(this.chatId), media: 'attach://media' }
    if (caption) fields.caption = caption.slice(0, 1024)
    const result = await this._upload(method, fields, { filename, contentType: mimeType, buffer })

    if (mediaType === 'image') {
      const sizes = Array.isArray(result.photo) ? result.photo : []
      const largest = sizes[sizes.length - 1] || {}
      return {
        messageId: result.message_id,
        fileId: largest.file_id,
        thumbFileId: null,
        fileSize: largest.file_size ?? buffer.length,
        width: largest.width ?? null,
        height: largest.height ?? null,
        duration: null,
        fileName: filename
      }
    }

    if (mediaType === 'video') {
      const v = result.video || {}
      return {
        messageId: result.message_id,
        fileId: v.file_id,
        thumbFileId: v.thumb?.file_id ?? null,
        fileSize: v.file_size ?? buffer.length,
        width: v.width ?? null,
        height: v.height ?? null,
        duration: v.duration ?? null,
        fileName: filename
      }
    }

    const d = result.document || {}
    return {
      messageId: result.message_id,
      fileId: d.file_id,
      thumbFileId: d.thumb?.file_id ?? null,
      fileSize: d.file_size ?? buffer.length,
      width: d.width ?? null,
      height: d.height ?? null,
      duration: d.duration ?? null,
      fileName: d.file_name || filename
    }
  }

  /**
   * Fetch a stored file, following redirects while preserving the Range header
   * so browser video seeking works against Telegram's file CDN.
   * @returns { status, headers, buffer }
   */
  async fetchFile(filePath, rangeHeader) {
    let url = this.downloadUrl(filePath)
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(url, {
        headers: rangeHeader ? { Range: rangeHeader, Accept: '*/*' } : { Accept: '*/*' },
        redirect: 'manual'
      })
      const status = res.status
      if (status >= 300 && status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), url).toString()
        continue
      }
      if (!res.ok && status !== 206) {
        throw new TelegramError(`Telegram file request failed (HTTP ${status})`, status)
      }
      const buffer = Buffer.from(await res.arrayBuffer())
      const headers = {}
      for (const [key, value] of res.headers.entries()) headers[key.toLowerCase()] = value
      return { status, headers, buffer }
    }
    throw new TelegramError('Too many redirects from Telegram file server', 502)
  }
}

function randomToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
