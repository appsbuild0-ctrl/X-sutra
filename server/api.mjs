import { randomUUID } from 'node:crypto'
import { TELEGRAM_LIMITS, TELEGRAM_RETRIEVAL_LIMIT } from './config.mjs'
import { getServices } from './services.mjs'
import { TelegramError } from './telegram.mjs'
import { parseMultipart } from './multipart.mjs'
import {
  ADMIN_COOKIE_NAME,
  checkAdminPassword,
  createSessionToken,
  verifySessionToken,
  sessionCookie,
  readCookie
} from './auth.mjs'

const MB = 1024 * 1024

class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

function json(status, body, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status >= 400 ? 'no-store' : 'private, max-age=15',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  }
}

function classifyMediaType(mime) {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'file'
}

const ALLOWED_DOC_PREFIXES = ['text/', 'audio/']
const ALLOWED_DOC_TYPES = new Set([
  'application/pdf', 'application/rtf', 'application/json', 'application/epub+zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/x-zip-compressed',
  'application/x-rar-compressed', 'application/vnd.rar',
  'application/x-7z-compressed', 'application/gzip', 'application/x-tar',
  'application/octet-stream'
])

function isAllowedDocument(mime) {
  return ALLOWED_DOC_PREFIXES.some((p) => mime.startsWith(p)) || ALLOWED_DOC_TYPES.has(mime)
}

function toMediaItem(record) {
  const stream = `/api/media/${record.id}/stream`
  const thumb = `/api/media/${record.id}/thumbnail`
  const file = `/api/media/${record.id}/file`
  const isImage = record.mediaType === 'image'
  const isVideo = record.mediaType === 'video'
  return {
    id: record.id,
    title: record.title || record.fileName || 'Untitled',
    description: record.caption || '',
    creator: 'studio',
    thumbnail: isImage ? stream : thumb,
    thumbnailUrls: isImage ? [stream] : record.thumbFileId ? [thumb] : [],
    previewUrl: isVideo ? stream : undefined,
    videoUrl: isVideo ? stream : undefined,
    videoUrlSd: isVideo ? stream : undefined,
    sourceUrl: record.mediaType === 'file' ? file : thumb,
    duration: record.duration ?? 0,
    likes: 0,
    views: 0,
    width: record.width ?? 0,
    height: record.height ?? 0,
    createdAt: record.createdAt,
    hasAudio: isVideo,
    tags: ['studio'],
    niches: [],
    mediaType: record.mediaType,
    fileUrl: record.mediaType === 'file' ? file : undefined,
    fileSize: record.fileSize,
    fileName: record.fileName
  }
}

function requireAdmin(req, config) {
  const token = readCookie(req, ADMIN_COOKIE_NAME)
  if (!verifySessionToken(token, config.sessionSecret)) {
    throw new HttpError(401, 'Admin sign-in required to manage media.')
  }
}

async function serveStream(req, record, { isThumbnail }) {
  const { bot } = getServices()
  const fileId = isThumbnail ? (record.thumbFileId || record.fileId) : record.fileId
  const contentType = isThumbnail
    ? (record.mediaType === 'image' ? record.mimeType : 'image/jpeg')
    : record.mimeType
  const info = await bot.getFile(fileId)
  const rangeHeader = req.headers['range'] || null
  const result = await bot.fetchFile(info.file_path, rangeHeader)

  let buffer = result.buffer
  let status = result.status
  let contentRange = result.headers['content-range']
  let contentLength = result.headers['content-length'] || String(buffer.length)

  // If we asked for a range but Telegram returned the whole file, synthesize a 206.
  if (rangeHeader && status === 200) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
    if (match) {
      const start = Number(match[1])
      const end = match[2] ? Number(match[2]) : buffer.length - 1
      const clampedEnd = Math.min(end, buffer.length - 1)
      if (start <= clampedEnd && start < buffer.length) {
        buffer = buffer.subarray(start, clampedEnd + 1)
        status = 206
        contentRange = `bytes ${start}-${clampedEnd}/${buffer.length}`
        contentLength = String(buffer.length)
      }
    }
  }

  return {
    statusCode: status,
    headers: {
      'Content-Type': contentType,
      'Content-Length': contentLength,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300',
      ...(contentRange ? { 'Content-Range': contentRange } : {})
    },
    body: buffer
  }
}

async function handleUpload(req) {
  const { config, bot, store } = getServices()
  requireAdmin(req, config)

  if (!req.body || req.body.length === 0) {
    throw new HttpError(400, 'No file was provided.')
  }
  const contentType = req.headers['content-type'] || ''
  let parts
  try {
    parts = parseMultipart(req.body, contentType)
  } catch {
    throw new HttpError(400, 'Upload must be multipart/form-data.')
  }
  const filePart = parts.find((p) => p.name === 'file' && p.filename)
  if (!filePart) throw new HttpError(400, 'No file field found in the upload.')

  const title = parts.find((p) => p.name === 'title')?.body.toString('utf8')?.trim() || ''
  const caption = parts.find((p) => p.name === 'caption')?.body.toString('utf8')?.trim() || ''

  const mime = (filePart.contentType || 'application/octet-stream').toLowerCase()
  const mediaType = classifyMediaType(mime)
  if (mediaType === 'file' && !isAllowedDocument(mime)) {
    throw new HttpError(415, `Unsupported file type: ${mime}. Upload images, videos, or common documents.`)
  }

  const limit = TELEGRAM_LIMITS[mediaType]
  if (filePart.body.length > limit) {
    const human = (limit / MB).toFixed(0)
    throw new HttpError(
      413,
      `This ${mediaType} is ${(filePart.body.length / MB).toFixed(1)} MB, which exceeds Telegram's ${human} MB upload limit for the current storage configuration.`
    )
  }
  if (filePart.body.length === 0) {
    throw new HttpError(400, 'The selected file is empty.')
  }

  let uploaded
  try {
    uploaded = await bot.uploadMedia(mediaType, filePart.body, filePart.filename, mime, caption)
  } catch (error) {
    if (error instanceof TelegramError) {
      throw new HttpError(error.status || 502, `Telegram storage error: ${error.message}`)
    }
    throw error
  }

  const record = {
    id: randomUUID(),
    telegramChatId: String(config.chatId),
    telegramMessageId: uploaded.messageId,
    fileId: uploaded.fileId,
    thumbFileId: uploaded.thumbFileId ?? null,
    fileName: uploaded.fileName || filePart.filename,
    mimeType: mime,
    fileSize: uploaded.fileSize ?? filePart.body.length,
    mediaType,
    createdAt: Date.now(),
    uploader: 'admin',
    duration: uploaded.duration ?? null,
    width: uploaded.width ?? null,
    height: uploaded.height ?? null,
    title: title || '',
    caption: caption || ''
  }
  await store.create(record)
  return json(201, toMediaItem(record))
}

export async function handleApiRequest(req) {
  const url = req.pathname
  const method = (req.method || 'GET').toUpperCase()

  try {
    if (url === '/api/health') return json(200, { ok: true })

    // ---- Admin auth -------------------------------------------------------
    if (url === '/api/admin/login' && method === 'POST') {
      const { config } = getServices()
      let password = ''
      try {
        const parsed = JSON.parse((req.body || Buffer.alloc(0)).toString('utf8') || '{}')
        password = parsed.password ?? ''
      } catch { /* ignore */ }
      if (!config.adminPassword) {
        throw new HttpError(503, 'Admin access is not configured on the server (set ADMIN_PASSWORD).')
      }
      if (!config.sessionSecret) {
        throw new HttpError(503, 'Admin sessions are not configured on the server (set ADMIN_SESSION_SECRET).')
      }
      if (!checkAdminPassword(password)) {
        throw new HttpError(401, 'Incorrect admin password.')
      }
      const token = createSessionToken(config.sessionSecret, config.sessionTtl)
      return json(200, { ok: true, admin: true }, {
        'Set-Cookie': sessionCookie(token, { maxAgeMs: config.sessionTtl })
      })
    }

    if (url === '/api/admin/logout' && method === 'POST') {
      return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('', { clear: true }) })
    }

    if (url === '/api/admin/session' && method === 'GET') {
      const { config } = getServices()
      const token = readCookie(req, ADMIN_COOKIE_NAME)
      return json(200, { admin: verifySessionToken(token, config.sessionSecret) })
    }

    // ---- Media upload (admin only) ---------------------------------------
    if (url === '/api/media/upload' && method === 'POST') {
      return await handleUpload(req)
    }

    // ---- Media list / detail (public) ------------------------------------
    if (url === '/api/media' && method === 'GET') {
      const { store } = getServices()
      const items = await store.list()
      return json(200, { items: items.map(toMediaItem), total: items.length })
    }

    const detail = /^\/api\/media\/([^/]+)$/.exec(url)
    if (detail && method === 'GET') {
      const { store } = getServices()
      const record = await store.get(detail[1])
      if (!record) throw new HttpError(404, 'Media not found.')
      return json(200, toMediaItem(record))
    }

    const streamMatch = /^\/api\/media\/([^/]+)\/stream$/.exec(url)
    if (streamMatch && method === 'GET') {
      const { store } = getServices()
      const record = await store.get(streamMatch[1])
      if (!record) throw new HttpError(404, 'Media not found.')
      if (record.fileSize > TELEGRAM_RETRIEVAL_LIMIT) {
        throw new HttpError(502, 'This file exceeds Telegram\'s bot download limit on the public API. Use a self-hosted Local Bot API Server (TELEGRAM_API_BASE) for files above 20 MB.')
      }
      return await serveStream(req, record, { isThumbnail: false })
    }

    const thumbMatch = /^\/api\/media\/([^/]+)\/thumbnail$/.exec(url)
    if (thumbMatch && method === 'GET') {
      const { store } = getServices()
      const record = await store.get(thumbMatch[1])
      if (!record) throw new HttpError(404, 'Media not found.')
      return await serveStream(req, record, { isThumbnail: true })
    }

    const fileMatch = /^\/api\/media\/([^/]+)\/file$/.exec(url)
    if (fileMatch && method === 'GET') {
      const { store } = getServices()
      const record = await store.get(fileMatch[1])
      if (!record) throw new HttpError(404, 'Media not found.')
      if (record.fileSize > TELEGRAM_RETRIEVAL_LIMIT) {
        throw new HttpError(502, 'This file exceeds Telegram\'s bot download limit on the public API. Use a self-hosted Local Bot API Server (TELEGRAM_API_BASE) for files above 20 MB.')
      }
      const safeName = (record.fileName || 'file').replace(/[^\w.-]+/g, '_')
      const response = await serveStream(req, record, { isThumbnail: false })
      response.headers['Content-Disposition'] = `attachment; filename="${safeName}"`
      return response
    }

    const deleteMatch = /^\/api\/media\/([^/]+)$/.exec(url)
    if (deleteMatch && method === 'DELETE') {
      const { config, bot, store } = getServices()
      requireAdmin(req, config)
      const record = await store.get(deleteMatch[1])
      if (!record) throw new HttpError(404, 'Media not found.')
      try {
        await bot.deleteMessage(record.telegramMessageId)
      } catch (error) {
        // If the message is already gone from Telegram, still drop our reference.
        if (!(error instanceof TelegramError)) throw error
        console.warn('[media] Telegram delete failed (continuing to remove reference):', error.message)
      }
      await store.remove(record.id)
      return json(200, { ok: true, id: record.id })
    }

    throw new HttpError(404, 'Not found.')
  } catch (error) {
    if (error instanceof HttpError) {
      return json(error.status, { error: error.message })
    }
    if (error instanceof TelegramError) {
      return json(error.status || 502, { error: `Telegram error: ${error.message}` })
    }
    console.error('[api] Unhandled error:', error)
    return json(500, { error: 'Unexpected server error while handling the request.' })
  }
}
