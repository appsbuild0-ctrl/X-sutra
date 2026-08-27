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

    // Telegram Login Widget accounts. The Telegram user id is the identifier;
    // no password, OTP or session string is ever stored.
    await sql`create table if not exists xs_users (id text primary key, telegram_id text not null unique, first_name text not null default '', last_name text not null default '', username text not null default '', photo_url text not null default '', role text not null default 'normal', status text not null default 'on', session_revoked_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`
    // Admin rights are data, never a frontend secret. TELEGRAM_ADMIN_IDS only
    // seeds this table the first time so the very first admin can get in.
    await sql`create table if not exists xs_admin_telegram_ids (telegram_id text primary key, label text not null default '', created_at timestamptz not null default now())`
    // Admin uploads: metadata plus fixed-size byte chunks (Vercel caps a single
    // function body at ~4.5MB, so files arrive in pieces and are reassembled).
    await sql`create table if not exists xs_uploads (id text primary key, kind text not null, title text not null, category text not null default 'General', thumbnail text not null default '', mime_type text not null, filename text not null default '', bytes bigint not null default 0, chunk_size integer not null, chunks integer not null default 0, status text not null default 'pending', access_role text not null default 'public', published boolean not null default true, owner_telegram_id text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now())`
    await sql`create table if not exists xs_upload_chunks (upload_id text not null references xs_uploads(id) on delete cascade, idx integer not null, bytes bytea not null, primary key (upload_id, idx))`

    for (const telegramId of seededAdminIds()) {
      await sql`insert into xs_admin_telegram_ids (telegram_id, label) values (${telegramId}, 'TELEGRAM_ADMIN_IDS') on conflict (telegram_id) do nothing`
    }
  })()
  return ready
}

/** Bootstrap admins from TELEGRAM_ADMIN_IDS (comma/space separated numeric ids). */
export function seededAdminIds() {
  return String(process.env.TELEGRAM_ADMIN_IDS || '')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => /^\d{1,20}$/.test(value))
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

// `??` cannot express "clear this column": an explicit null in the patch must
// win over the stored value (the OTP hash is wiped the moment a login succeeds,
// and a discarded session resets telegram_user_id).
const pick = (patch, current, key, fallback) => (key in patch ? patch[key] : current?.[key] ?? fallback)

export async function saveAuth(patch) {
  await ensureSchema(); const current = await authState()
  const next = {
    encrypted_session: pick(patch, current, 'encrypted_session', ''),
    phone_code_hash: pick(patch, current, 'phone_code_hash', null),
    status: pick(patch, current, 'status', 'pending'),
    telegram_user_id: pick(patch, current, 'telegram_user_id', null)
  }
  await db()`insert into xs_telegram_auth (id,encrypted_session,phone_code_hash,status,telegram_user_id) values ('owner',${next.encrypted_session},${next.phone_code_hash},${next.status},${next.telegram_user_id}) on conflict (id) do update set encrypted_session=excluded.encrypted_session,phone_code_hash=excluded.phone_code_hash,status=excluded.status,telegram_user_id=excluded.telegram_user_id,updated_at=now()`
  return next
}
