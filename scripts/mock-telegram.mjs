import { createServer } from 'node:http'
import { parseMultipart } from '../server/multipart.mjs'

/**
 * Faithful local stand-in for the Telegram Bot API, used only by the end-to-end
 * test. It implements the subset X-sutra uses (getMe, sendPhoto, sendVideo,
 * sendDocument, getFile, deleteMessage, and the /file download endpoint with
 * Range support). Real media bytes flow through it, so the integration logic is
 * exercised exactly as it would be against the real API.
 */

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

export function createMockTelegram() {
  const store = new Map() // fileId -> { buffer, contentType }
  let counter = 0
  const nextId = (prefix) => `${prefix}_${(++counter).toString(36)}`

  function saveBuffer(prefix, buffer, contentType) {
    const id = nextId(prefix)
    store.set(id, { buffer, contentType })
    return id
  }

  async function readBody(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    return Buffer.concat(chunks)
  }

  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(body)
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      const path = url.pathname
      const method = req.method || 'GET'

      if (path.endsWith('/getMe')) {
        return sendJson(res, 200, { ok: true, result: { id: 100000, is_bot: true, username: 'x_sutra_store_bot' } })
      }

      if (path.endsWith('/deleteMessage')) {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        return sendJson(res, 200, { ok: true, result: true, message_id: body.message_id })
      }

      if (path.endsWith('/getFile')) {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        const entry = store.get(body.file_id)
        if (!entry) return sendJson(res, 404, { ok: false, description: 'File not found' })
        return sendJson(res, 200, {
          ok: true,
          result: { file_id: body.file_id, file_unique_id: 'u', file_size: entry.buffer.length, file_path: `mock/${body.file_id}` }
        })
      }

      const sendMatch = /\/(sendPhoto|sendVideo|sendDocument)$/.exec(path)
      if (sendMatch && method === 'POST') {
        const buffer = await readBody(req)
        const ct = req.headers['content-type'] || ''
        const parts = parseMultipart(buffer, ct)
        const filePart = parts.find((p) => p.name === 'media' && p.filename)
        if (!filePart) return sendJson(res, 400, { ok: false, description: 'No media part' })
        const payloadType = sendMatch[1]
        const fileId = saveBuffer(payloadType[0], filePart.body, filePart.contentType || 'application/octet-stream')
        const messageId = ++counter
        let result
        if (payloadType === 'sendPhoto') {
          result = { message_id: messageId, photo: [{ file_id: fileId, file_unique_id: 'u', width: 640, height: 480, file_size: filePart.body.length }] }
        } else if (payloadType === 'sendVideo') {
          const thumbId = saveBuffer('t', TINY_PNG, 'image/png')
          result = {
            message_id: messageId,
            video: { file_id: fileId, file_unique_id: 'u', width: 640, height: 480, duration: 12, file_size: filePart.body.length, thumb: { file_id: thumbId, file_unique_id: 'u', width: 90, height: 90, file_size: TINY_PNG.length } }
          }
        } else {
          result = { message_id: messageId, document: { file_id: fileId, file_unique_id: 'u', file_name: filePart.filename, mime_type: filePart.contentType || 'application/octet-stream', file_size: filePart.body.length } }
        }
        return sendJson(res, 200, { ok: true, result })
      }

      if (path.startsWith('/file/')) {
        const fileId = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
        const entry = store.get(fileId)
        if (!entry) {
          res.writeHead(404)
          return res.end('not found')
        }
        const range = req.headers['range']
        if (range) {
          const m = /bytes=(\d+)-(\d*)/.exec(range)
          if (m) {
            const start = Number(m[1])
            const end = m[2] ? Number(m[2]) : entry.buffer.length - 1
            const slice = entry.buffer.subarray(start, Math.min(end, entry.buffer.length - 1) + 1)
            res.writeHead(206, {
              'Content-Type': entry.contentType,
              'Content-Range': `bytes ${start}-${Math.min(end, entry.buffer.length - 1)}/${entry.buffer.length}`,
              'Content-Length': String(slice.length),
              'Accept-Ranges': 'bytes'
            })
            return res.end(slice)
          }
        }
        res.writeHead(200, { 'Content-Type': entry.contentType, 'Content-Length': String(entry.buffer.length), 'Accept-Ranges': 'bytes' })
        return res.end(entry.buffer)
      }

      sendJson(res, 404, { ok: false, description: 'Unknown mock endpoint' })
    } catch (error) {
      sendJson(res, 500, { ok: false, description: String(error?.message || error) })
    }
  })

  return { server, store }
}
