import postgres from 'postgres'
import { validateSecurityEnv } from './security.mjs'

let client
export function db() {
  validateSecurityEnv(['DATABASE_URL'])
  if (!client) client = postgres(process.env.DATABASE_URL, { max: 2, idle_timeout: 20, connect_timeout: 15, ssl: 'require' })
  return client
}

let ready
export function ensureSchema() {
  if (!ready) ready = (async () => {
    const sql = db()
    await sql`create table if not exists xs_server_secrets (key text primary key, encrypted_value text not null, updated_at timestamptz not null default now())`
    await sql`create table if not exists xs_telegram_auth (id text primary key, encrypted_session text not null, phone_code_hash text, status text not null, telegram_user_id text, updated_at timestamptz not null default now())`
    await sql`create table if not exists xs_rate (key text primary key, last_at timestamptz not null default now(), count integer not null default 1, window_start timestamptz not null default now())`
    await sql`create table if not exists xs_channels (id text primary key, title text not null, avatar text, category text not null default 'mixed', published boolean not null default true, access_role text not null default 'premium', updated_at timestamptz not null default now())`
    await sql`create table if not exists xs_media (id text primary key, channel_id text not null references xs_channels(id) on delete cascade, telegram_message_id bigint not null, kind text not null, title text, mime_type text, duration integer, grouped_id text, published boolean not null default true, created_at timestamptz not null, unique(channel_id, telegram_message_id))`
    // Discord imports: the channel row and every imported message attachment are
    // kept here so the stored bytes have a durable index (which channel, which
    // message, which attachment, intrinsic size) instead of only living in the
    // premium catalog blob.
    await sql`create table if not exists xs_discord_channels (id text primary key, guild_id text not null default '', name text not null, topic text not null default '', kind text not null default 'text', imported_count integer not null default 0, last_synced_at timestamptz, updated_at timestamptz not null default now())`
    await sql`create table if not exists xs_discord_media (id text primary key, channel_id text not null references xs_discord_channels(id) on delete cascade, channel_name text not null default '', message_id text not null, attachment_id text not null, kind text not null, title text not null default '', filename text not null default '', mime_type text not null default '', width integer not null default 0, height integer not null default 0, bytes bigint not null default 0, storage_key text not null default '', url text not null default '', author_id text not null default '', author_name text not null default '', published boolean not null default true, message_at timestamptz not null default now(), created_at timestamptz not null default now(), unique(channel_id, message_id, attachment_id))`
  })()
  return ready
}

// The simple OTP login needs no secret, so sending codes is throttled here:
// at most one code per minute and five per hour per caller.
export async function assertOtpRateLimit(caller) {
  await ensureSchema()
  const key = `otp:${String(caller || 'unknown').slice(0, 64)}`
  const now = Date.now()
  const rows = await db()`select last_at, count, window_start from xs_rate where key=${key}`
  const row = rows[0]
  if (row) {
    if (now - Date.parse(row.last_at) < 60_000) throw Object.assign(new Error('A code was just sent. Wait a minute before requesting another.'), { statusCode: 429 })
    const inWindow = now - Date.parse(row.window_start) < 3_600_000
    const count = inWindow ? row.count + 1 : 1
    if (inWindow && count > 5) throw Object.assign(new Error('Too many codes requested this hour. Try again later.'), { statusCode: 429 })
    await db()`update xs_rate set last_at=now(), count=${count}, window_start=${inWindow ? row.window_start : new Date(now).toISOString()} where key=${key}`
  } else {
    await db()`insert into xs_rate (key, last_at, count, window_start) values (${key}, now(), 1, now()) on conflict (key) do update set last_at=now(), count=1, window_start=now()`
  }
}

/**
 * Upsert Telegram source channels discovered from the owner's dialogs.
 * Only Telegram-owned fields are refreshed: `published` and `access_role` are
 * deliberately left alone so hiding a source (or opening it to VIP only) in the
 * admin panel survives the next sync.
 */
export async function upsertChannels(rows) {
  await ensureSchema()
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return 0
  const sql = db()
  for (const row of list) {
    await sql`insert into xs_channels (id,title,avatar,category) values (${String(row.id)},${String(row.title)},${row.avatar ?? null},${String(row.category)})
              on conflict (id) do update set title=excluded.title, avatar=coalesce(excluded.avatar,xs_channels.avatar), category=excluded.category, updated_at=now()`
  }
  return list.length
}

export async function authState() { await ensureSchema(); const rows = await db()`select * from xs_telegram_auth where id='owner'`; return rows[0] || null }
export async function saveAuth(patch) {
  await ensureSchema(); const current = await authState()
  const next = { encrypted_session: patch.encrypted_session ?? current?.encrypted_session ?? '', phone_code_hash: patch.phone_code_hash ?? current?.phone_code_hash ?? null, status: patch.status ?? current?.status ?? 'pending', telegram_user_id: patch.telegram_user_id ?? current?.telegram_user_id ?? null }
  await db()`insert into xs_telegram_auth (id,encrypted_session,phone_code_hash,status,telegram_user_id) values ('owner',${next.encrypted_session},${next.phone_code_hash},${next.status},${next.telegram_user_id}) on conflict (id) do update set encrypted_session=excluded.encrypted_session,phone_code_hash=excluded.phone_code_hash,status=excluded.status,telegram_user_id=excluded.telegram_user_id,updated_at=now()`
  return next
}

// ---------------------------------------------------------------------------
// Discord imports — channel index + one row per imported message attachment.
// ---------------------------------------------------------------------------

export async function upsertDiscordChannel({ id, guildId = '', name = '', topic = '', kind = 'text', importedCount = 0 }) {
  await ensureSchema()
  const key = String(id || '').trim()
  if (!key) return null
  await db()`insert into xs_discord_channels (id,guild_id,name,topic,kind,imported_count,last_synced_at)
             values (${key},${String(guildId)},${String(name).slice(0, 100)},${String(topic).slice(0, 240)},${String(kind)},${Number(importedCount) || 0},now())
             on conflict (id) do update set name=excluded.name, topic=excluded.topic, kind=excluded.kind, guild_id=excluded.guild_id, imported_count=excluded.imported_count, last_synced_at=now(), updated_at=now()`
  return key
}

/**
 * Store imported media rows next to their channel. Re-running an import is a
 * no-op for rows already present (channel + message + attachment is unique).
 */
export async function upsertDiscordMedia(entries) {
  await ensureSchema()
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) return 0
  const sql = db()
  let saved = 0
  for (const entry of list) {
    const channelId = String(entry.sourceChannelId || '').trim()
    const messageId = String(entry.sourceMessageId || '').trim()
    const attachmentId = String(entry.sourceAttachmentId || '').trim()
    if (!channelId || !messageId || !attachmentId) continue
    const messageAt = new Date(entry.createdAt || Date.now()).toISOString()
    await sql`insert into xs_discord_media (id,channel_id,channel_name,message_id,attachment_id,kind,title,filename,mime_type,width,height,bytes,storage_key,url,author_id,author_name,message_at)
              values (${String(entry.id)},${channelId},${String(entry.sourceChannelName || '').slice(0, 100)},${messageId},${attachmentId},
                      ${entry.type === 'video' ? 'video' : 'image'},${String(entry.title || '').slice(0, 200)},${String(entry.filename || '').slice(0, 200)},
                      ${String(entry.mimeType || '').slice(0, 120)},${Number(entry.width) || 0},${Number(entry.height) || 0},${Number(entry.size) || 0},
                      ${String(entry.storageKey || '').slice(0, 120)},${String(entry.url || '')},${String(entry.author || '')},${String(entry.authorName || '').slice(0, 100)},${messageAt})
              on conflict (channel_id, message_id, attachment_id) do update set kind=excluded.kind, title=excluded.title, bytes=excluded.bytes, width=excluded.width, height=excluded.height, storage_key=excluded.storage_key, url=excluded.url, published=true`
    saved += 1
  }
  return saved
}

export async function listDiscordMedia({ limit = 60, channelId = '' } = {}) {
  await ensureSchema()
  const size = Math.max(1, Math.min(200, Number(limit) || 60))
  const rows = channelId
    ? await db()`select id,channel_id,channel_name,message_id,attachment_id,kind,title,filename,width,height,bytes,url,author_name,message_at from xs_discord_media where channel_id=${String(channelId)} order by message_at desc limit ${size}`
    : await db()`select id,channel_id,channel_name,message_id,attachment_id,kind,title,filename,width,height,bytes,url,author_name,message_at from xs_discord_media order by message_at desc limit ${size}`
  return rows
}

export async function discordImportedCount() {
  await ensureSchema()
  const rows = await db()`select count(*)::int total, count(distinct channel_id)::int channels from xs_discord_media`
  return { total: rows[0]?.total ?? 0, channels: rows[0]?.channels ?? 0 }
}
