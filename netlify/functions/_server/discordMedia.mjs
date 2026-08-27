// Database mapping for Discord-backed content. Each successful Discord upload
// stores one row here keyed by its real Discord message id.

import { db, ensureSchema } from './database.mjs'

const newId = () => `dm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export function kindFor(mimeType) {
  const type = String(mimeType || '').toLowerCase()
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('audio/')) return 'audio'
  return 'file'
}

/** Store the mapping only after Discord confirms the message. */
export async function recordDiscordMedia(input) {
  await ensureSchema()
  const id = String(input.id || newId())
  const rows = await db()`
    insert into xs_discord_media
      (id, title, description, filename, bytes, mime_type, kind, discord_guild_id, discord_channel_id, discord_message_id, attachment_url, access_role, status)
    values (
      ${id}, ${String(input.title || input.filename || 'Untitled')}, ${String(input.description || '')},
      ${String(input.filename || '')}, ${Number(input.bytes || 0)}, ${String(input.mimeType || 'application/octet-stream')},
      ${String(input.kind || kindFor(input.mimeType))}, ${String(input.guildId)}, ${String(input.channelId)},
      ${String(input.messageId)}, ${String(input.attachmentUrl || '')},
      ${['public', 'premium', 'vip', 'admin'].includes(input.accessRole) ? input.accessRole : 'premium'}, 'ready'
    )
    on conflict (id) do update set
      title=excluded.title, description=excluded.description, discord_message_id=excluded.discord_message_id,
      attachment_url=excluded.attachment_url, status='ready', updated_at=now()
    returning *`
  return rows[0]
}

export async function getDiscordMedia(id) {
  await ensureSchema()
  const rows = await db()`select * from xs_discord_media where id=${String(id)} limit 1`
  return rows[0] || null
}

export async function listDiscordMedia({ includeDeleted = false } = {}) {
  await ensureSchema()
  const rows = includeDeleted
    ? await db()`select * from xs_discord_media order by created_at desc limit 500`
    : await db()`select * from xs_discord_media where status='ready' order by created_at desc limit 500`
  return rows
}

// ---- transient chunk storage (browser → backend, then Discord) -------------

export async function writeChunk(uploadId, index, bytes) {
  await ensureSchema()
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '')
  await db()`insert into xs_discord_chunks (upload_id, idx, bytes) values (${String(uploadId)}, ${Number(index)}, ${data}) on conflict (upload_id, idx) do update set bytes=excluded.bytes`
  const counted = await db()`select count(*)::int n from xs_discord_chunks where upload_id=${String(uploadId)}`
  return Number(counted[0]?.n ?? 0)
}

export async function assembleChunks(uploadId) {
  await ensureSchema()
  const rows = await db()`select idx, bytes from xs_discord_chunks where upload_id=${String(uploadId)} order by idx asc`
  return Buffer.concat(rows.map((row) => (Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes))))
}

export async function clearChunks(uploadId) {
  await ensureSchema()
  await db()`delete from xs_discord_chunks where upload_id=${String(uploadId)}`
}

export async function markDeleted(id) {
  await ensureSchema()
  const rows = await db()`update xs_discord_media set status='deleted', updated_at=now() where id=${String(id)} returning *`
  return rows[0] || null
}

/** What regular users see: no guild/channel/message ids, no secrets. */
export function publicDiscordMedia(row, { admin = false } = {}) {
  if (!row) return null
  const base = {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description || ''),
    kind: String(row.kind),
    filename: String(row.filename || ''),
    bytes: Number(row.bytes || 0),
    url: String(row.attachment_url || ''),
    accessRole: String(row.access_role || 'premium'),
    status: String(row.status || 'ready'),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || '')
  }
  if (admin) {
    base.discordMessageId = String(row.discord_message_id)
    base.discordChannelId = String(row.discord_channel_id)
    base.discordGuildId = String(row.discord_guild_id)
    base.mimeType = String(row.mime_type || '')
  }
  return base
}
