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
    await sql`create table if not exists xs_channels (id text primary key, title text not null, avatar text, category text not null default 'mixed', published boolean not null default true, access_role text not null default 'premium', updated_at timestamptz not null default now())`
    await sql`create table if not exists xs_media (id text primary key, channel_id text not null references xs_channels(id) on delete cascade, telegram_message_id bigint not null, kind text not null, title text, mime_type text, duration integer, grouped_id text, published boolean not null default true, created_at timestamptz not null, unique(channel_id, telegram_message_id))`
  })()
  return ready
}

export async function authState() { await ensureSchema(); const rows = await db()`select * from xs_telegram_auth where id='owner'`; return rows[0] || null }
export async function saveAuth(patch) {
  await ensureSchema(); const current = await authState()
  const next = { encrypted_session: patch.encrypted_session ?? current?.encrypted_session ?? '', phone_code_hash: patch.phone_code_hash ?? current?.phone_code_hash ?? null, status: patch.status ?? current?.status ?? 'pending', telegram_user_id: patch.telegram_user_id ?? current?.telegram_user_id ?? null }
  await db()`insert into xs_telegram_auth (id,encrypted_session,phone_code_hash,status,telegram_user_id) values ('owner',${next.encrypted_session},${next.phone_code_hash},${next.status},${next.telegram_user_id}) on conflict (id) do update set encrypted_session=excluded.encrypted_session,phone_code_hash=excluded.phone_code_hash,status=excluded.status,telegram_user_id=excluded.telegram_user_id,updated_at=now()`
  return next
}
