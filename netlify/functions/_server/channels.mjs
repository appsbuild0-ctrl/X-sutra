// Telegram source channels, stored in xs_channels and managed from the admin
// panel. Writes are admin-gated on the server; the owner's own channel id is
// seeded automatically so the source list is never empty on first run.

import { db, ensureSchema } from './database.mjs'

/**
 * The owner's channel, embedded so it exists without any manual setup. It is a
 * Telegram channel id (semi-public, not a credential) — safe to ship in code.
 * More ids can be added via TELEGRAM_SOURCE_CHANNEL_IDS.
 */
export const DEFAULT_SOURCE_CHANNEL = '-1004400682253'

export function seededChannelIds() {
  return [DEFAULT_SOURCE_CHANNEL, ...String(process.env.TELEGRAM_SOURCE_CHANNEL_IDS || '')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => /^-?\d{1,20}$/.test(value))]
}

const bad = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })

const cleanTitle = (value, fallback) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120) || fallback
const cleanCategory = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 48) || 'channel'

/** Idempotently create the built-in channels (first run). */
export async function seedDefaultChannels() {
  await ensureSchema()
  for (const id of seededChannelIds()) {
    await db()`insert into xs_channels (id, title, avatar, category) values (${id}, ${'Telegram Source'}, null, 'channel') on conflict (id) do nothing`
  }
  return true
}

export async function listChannels({ includeHidden = false } = {}) {
  await seedDefaultChannels()
  const rows = includeHidden
    ? await db()`select * from xs_channels order by updated_at desc limit 500`
    : await db()`select * from xs_channels where published=true order by updated_at desc limit 500`
  return rows.map(publicChannel)
}

export function publicChannel(row) {
  if (!row) return null
  return {
    id: String(row.id),
    title: String(row.title),
    category: String(row.category || 'channel'),
    avatar: row.avatar ?? null,
    accessRole: String(row.access_role || 'premium'),
    published: Boolean(row.published),
    mediaCount: Number(row.media_count ?? 0),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || '')
  }
}

export async function createChannel({ id, title, category, accessRole, published }) {
  await ensureSchema()
  const channelId = String(id || '').trim()
  if (!/^-?\d{1,20}$/.test(channelId)) throw bad('A Telegram channel id is numeric (usually starts with -100…).')
  await db()`
    insert into xs_channels (id, title, avatar, category, access_role, published)
    values (${channelId}, ${cleanTitle(title, 'Telegram Source')}, null, ${cleanCategory(category)},
            ${['public', 'premium', 'vip', 'admin'].includes(accessRole) ? accessRole : 'premium'}, ${published !== false})
    on conflict (id) do update set title=excluded.title, category=excluded.category, updated_at=now()`
  return listChannels({ includeHidden: true })
}

export async function updateChannel({ id, title, category, accessRole, published }) {
  await ensureSchema()
  const sql = db()
  const channelId = String(id || '').trim()
  const rows = await sql`select id from xs_channels where id=${channelId} limit 1`
  if (!rows[0]) throw bad('That channel does not exist.', 404)
  const next = await sql`
    update xs_channels set updated_at=now()
      ${title !== undefined ? sql`,title=${cleanTitle(title, 'Telegram Source')}` : sql``}
      ${category !== undefined ? sql`,category=${cleanCategory(category)}` : sql``}
      ${accessRole !== undefined ? sql`,access_role=${['public', 'premium', 'vip', 'admin'].includes(accessRole) ? accessRole : 'premium'}` : sql``}
      ${published !== undefined ? sql`,published=${published !== false}` : sql``}
    where id=${channelId} returning *`
  return publicChannel(next[0])
}

// The owner adds the bot to the channel as admin, so the Bot API can read its
// public title. The token is read from the environment at call time and is
// never stored, returned, or written to code.
async function fetchChannelTitle(id, token) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(id)}`)
    const data = await response.json().catch(() => ({}))
    if (response.ok && data?.ok && data?.result?.title) return String(data.result.title).slice(0, 120)
  } catch { /* network blip: keep the stored name */ }
  return ''
}

/** Pull real channel names from Telegram for every stored source (bot must be a member). */
export async function syncChannelTitles() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
  if (!token) throw bad('TELEGRAM_BOT_TOKEN is not set — add it in Vercel to pull the real channel names.', 503)
  await seedDefaultChannels()
  const rows = await db()`select id from xs_channels`
  for (const row of rows) {
    const title = await fetchChannelTitle(String(row.id), token)
    if (title) await db()`update xs_channels set title=${title}, updated_at=now() where id=${row.id}`
  }
  return listChannels({ includeHidden: true })
}

export async function deleteChannel(id) {
  await ensureSchema()
  const channelId = String(id || '').trim()
  await db()`delete from xs_channels where id=${channelId}`
  return { ok: true, id: channelId }
}
