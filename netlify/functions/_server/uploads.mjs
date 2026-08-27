// Admin uploads stored in the existing Neon PostgreSQL database.
//
// Why chunks: a Vercel serverless function body is capped at ~4.5MB, so a video
// cannot be posted in one request. The browser splits the file into fixed-size
// pieces, each piece becomes one row in xs_upload_chunks, and playback reads the
// needed pieces back — which also gives real HTTP Range support, so the existing
// player keeps seeking normally.

import { db, ensureSchema } from './database.mjs'

/** Raw bytes per chunk. 3MB base64-encodes to ~4MB, safely under the 4.5MB cap. */
export const CHUNK_BYTES = 3 * 1024 * 1024

/**
 * Upper bound for one file response. Serverless platforms cap how much a single
 * function invocation may return, so a bigger range is answered as a smaller
 * partial — a perfectly valid 206, and the player simply asks for the rest.
 */
export const SERVE_BYTES = CHUNK_BYTES

export function maxUploadBytes() {
  const mb = Number(process.env.MAX_UPLOAD_MB)
  return Number.isFinite(mb) && mb > 0 ? Math.floor(mb * 1024 * 1024) : 200 * 1024 * 1024
}

const KINDS = {
  'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video', 'video/x-matroska': 'video', 'video/ogg': 'video',
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image',
  'audio/mpeg': 'audio', 'audio/mp4': 'audio', 'audio/webm': 'audio',
  'application/pdf': 'file'
}

const ACCESS_ROLES = ['public', 'premium', 'vip', 'admin']

const bad = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })

const safeId = (value) => {
  const clean = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '')
  if (!clean || clean.length > 64) throw bad('Invalid upload id.')
  return clean
}

function cleanTitle(value, fallback = 'Untitled upload') {
  const title = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return title || fallback
}

function cleanCategory(value) {
  const category = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 48)
  return category || 'General'
}

/** Accepts a data: URL produced by the thumbnail picker or an https image URL. */
function cleanThumbnail(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('data:image/')) {
    if (raw.length > 900_000) throw bad('Thumbnail is too large — pick an image under ~600KB.')
    return raw
  }
  if (/^https:\/\/[^\s]{1,500}$/i.test(raw)) return raw
  throw bad('Thumbnail must be an image data URL or an https image URL.')
}

export async function startUpload(input) {
  await ensureSchema()
  const mimeType = String(input.contentType || '').toLowerCase().split(';')[0].trim()
  const kind = KINDS[mimeType]
  if (!kind) throw bad(`Unsupported file type "${mimeType || 'unknown'}". Allowed: MP4/WebM/MOV video, JPEG/PNG/WebP/GIF image, MP3 audio, PDF.`)
  const size = Number(input.size)
  if (!Number.isFinite(size) || size <= 0) throw bad('File size is required.')
  if (size > maxUploadBytes()) throw bad(`File is ${(size / 1048576).toFixed(1)}MB — the limit is ${Math.floor(maxUploadBytes() / 1048576)}MB (raise MAX_UPLOAD_MB).`, 413)

  const id = `up${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const chunks = Math.ceil(size / CHUNK_BYTES)
  await db()`
    insert into xs_uploads (id, kind, title, category, thumbnail, mime_type, filename, bytes, chunk_size, chunks, status, access_role, published, owner_telegram_id)
    values (${id}, ${kind}, ${cleanTitle(input.title)}, ${cleanCategory(input.category)}, ${cleanThumbnail(input.thumbnail)},
            ${mimeType}, ${String(input.filename || '').slice(0, 160)}, ${size}, ${CHUNK_BYTES}, ${chunks}, 'pending',
            ${ACCESS_ROLES.includes(input.accessRole) ? input.accessRole : 'public'}, ${input.published !== false}, ${String(input.ownerTelegramId || '')})`
  return { id, kind, chunks, chunkSize: CHUNK_BYTES, url: uploadUrl(id) }
}

export function uploadUrl(id) {
  return `/api/uploads/${encodeURIComponent(String(id))}`
}

export async function writeUploadChunk({ id, index, bytes }) {
  await ensureSchema()
  const uploadId = safeId(id)
  const rows = await db()`select id, chunk_size, chunks, bytes, status from xs_uploads where id=${uploadId} limit 1`
  const upload = rows[0]
  if (!upload) throw bad('That upload does not exist (or expired). Start the upload again.', 404)
  if (upload.status === 'ready') throw bad('That upload is already finished.')
  const idx = Number(index)
  if (!Number.isInteger(idx) || idx < 0 || idx >= Number(upload.chunks)) throw bad(`Chunk index ${index} is outside this upload (0…${Number(upload.chunks) - 1}).`)
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '')
  if (!data.length) throw bad('Chunk is empty.')
  const expected = idx === Number(upload.chunks) - 1 ? Number(upload.bytes) - idx * Number(upload.chunk_size) : Number(upload.chunk_size)
  if (data.length > expected) throw bad(`Chunk ${idx} is ${data.length} bytes, expected at most ${expected}.`)
  await db()`
    insert into xs_upload_chunks (upload_id, idx, bytes) values (${uploadId}, ${idx}, ${data})
    on conflict (upload_id, idx) do update set bytes=excluded.bytes`
  const done = await db()`select count(*)::int received from xs_upload_chunks where upload_id=${uploadId}`
  return { received: done[0]?.received ?? 0, expected: Number(upload.chunks) }
}

export async function finishUpload({ id, title, category, thumbnail }) {
  await ensureSchema()
  // The sql tag itself — nested fragments (the optional SET columns below) must
  // be built with it, not with the db() wrapper.
  const sql = db()
  const uploadId = safeId(id)
  const rows = await sql`select * from xs_uploads where id=${uploadId} limit 1`
  const upload = rows[0]
  if (!upload) throw bad('That upload does not exist.', 404)
  const counted = await sql`select count(*)::int received, coalesce(sum(octet_length(bytes)), 0)::bigint stored from xs_upload_chunks where upload_id=${uploadId}`
  const received = Number(counted[0]?.received ?? 0)
  const stored = Number(counted[0]?.stored ?? 0)
  if (received !== Number(upload.chunks)) throw bad(`Only ${received} of ${Number(upload.chunks)} chunks arrived — upload the file again.`)
  if (stored !== Number(upload.bytes)) throw bad(`Received ${stored} of ${Number(upload.bytes)} bytes — upload the file again.`)
  const next = await sql`
    update xs_uploads set status='ready', updated_at=now()
      ${title !== undefined ? sql`,title=${cleanTitle(title)}` : sql``}
      ${category !== undefined ? sql`,category=${cleanCategory(category)}` : sql``}
      ${thumbnail !== undefined ? sql`,thumbnail=${cleanThumbnail(thumbnail)}` : sql``}
    where id=${uploadId} returning *`
  return publicUpload(next[0] || upload)
}

export async function updateUpload({ id, title, category, thumbnail, published, accessRole }) {
  await ensureSchema()
  const sql = db()
  const uploadId = safeId(id)
  const rows = await sql`select * from xs_uploads where id=${uploadId} limit 1`
  if (!rows[0]) throw bad('That upload does not exist.', 404)
  const next = await sql`
    update xs_uploads set updated_at=now()
      ${title !== undefined ? sql`,title=${cleanTitle(title)}` : sql``}
      ${category !== undefined ? sql`,category=${cleanCategory(category)}` : sql``}
      ${thumbnail !== undefined ? sql`,thumbnail=${cleanThumbnail(thumbnail)}` : sql``}
      ${published !== undefined ? sql`,published=${published !== false}` : sql``}
      ${accessRole !== undefined ? sql`,access_role=${ACCESS_ROLES.includes(accessRole) ? accessRole : 'public'}` : sql``}
    where id=${uploadId} returning *`
  return publicUpload(next[0])
}

export async function deleteUpload(id) {
  await ensureSchema()
  const uploadId = safeId(id)
  await db()`delete from xs_uploads where id=${uploadId}`
  return { ok: true, id: uploadId }
}

export const canSee = (accessRole, role) => {
  if (accessRole === 'public') return true
  if (role === 'admin') return true
  if (accessRole === 'premium') return role === 'premium' || role === 'vip'
  if (accessRole === 'vip') return role === 'vip'
  return false
}

/** Metadata list for the frontend — never contains file bytes. */
export async function listUploads({ role = 'normal', includeHidden = false } = {}) {
  await ensureSchema()
  const rows = includeHidden
    ? await db()`select * from xs_uploads order by created_at desc limit 500`
    : await db()`select * from xs_uploads where status='ready' and published=true order by created_at desc limit 500`
  return rows.filter((row) => includeHidden || canSee(String(row.access_role), String(role))).map(publicUpload)
}

export async function listCategories() {
  await ensureSchema()
  const rows = await db()`select category, count(*)::int total from xs_uploads where status='ready' group by category order by category asc`
  return rows.map((row) => ({ category: String(row.category), total: Number(row.total) }))
}

// Metadata only — never file bytes. Sync on purpose: callers map it straight
// into a JSON response, and an async mapper would serialise to null.
export function publicUpload(row) {
  if (!row) return null
  return {
    id: String(row.id),
    kind: String(row.kind),
    title: String(row.title),
    category: String(row.category),
    thumbnail: String(row.thumbnail || ''),
    mimeType: String(row.mime_type),
    filename: String(row.filename || ''),
    bytes: Number(row.bytes),
    status: String(row.status),
    accessRole: String(row.access_role),
    published: Boolean(row.published),
    url: uploadUrl(row.id),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || '')
  }
}

export async function getUploadMeta(id) {
  await ensureSchema()
  const rows = await db()`select * from xs_uploads where id=${safeId(id)} limit 1`
  return rows[0] || null
}

/**
 * Read a byte range straight out of the chunk rows. Returning real
 * Content-Range/206 responses is what lets the existing <video> player seek.
 */
export async function readUploadRange(id, rangeHeader = '') {
  const upload = await getUploadMeta(id)
  if (!upload) throw bad('Not found.', 404)
  if (upload.status !== 'ready') throw bad('That file is still uploading.', 409)

  const size = Number(upload.bytes)
  const chunkSize = Number(upload.chunk_size)
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader || '').trim())
  let start = 0
  let end = size - 1
  let partial = false
  if (match && (match[1] || match[2])) {
    partial = true
    if (match[1]) {
      start = Number(match[1])
      end = match[2] ? Number(match[2]) : size - 1
    } else {
      // suffix range: last N bytes
      start = Math.max(0, size - Number(match[2]))
      end = size - 1
    }
  }
  if (start < 0 || start >= size || end < start) throw bad('Range not satisfiable.', 416)
  end = Math.min(end, size - 1, start + SERVE_BYTES - 1)
  partial = true

  const firstChunk = Math.floor(start / chunkSize)
  const lastChunk = Math.floor(end / chunkSize)
  const rows = await db()`select idx, bytes from xs_upload_chunks where upload_id=${String(upload.id)} and idx between ${firstChunk} and ${lastChunk} order by idx asc`
  const pieces = []
  for (const row of rows) {
    const offset = Number(row.idx) * chunkSize
    const buffer = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes)
    pieces.push(buffer.subarray(Math.max(0, start - offset), Math.min(buffer.length, end - offset + 1)))
  }
  const body = Buffer.concat(pieces)
  if (body.length !== end - start + 1) throw bad(`Stored chunks are incomplete (${body.length} of ${end - start + 1} bytes).`, 500)

  return {
    status: partial ? 206 : 200,
    body,
    headers: {
      'content-type': String(upload.mime_type || 'application/octet-stream'),
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=3600',
      ...(partial ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
      'content-disposition': `inline; filename="${String(upload.filename || upload.id).replace(/["\\\r\n]/g, '')}"`
    }
  }
}
