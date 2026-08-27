// Shared PostgreSQL (Neon) access for the X-Sutra backend.
//
// Telegram is gone; the only content table added for the Discord integration is
// xs_discord_media, which maps each X-Sutra upload to the real Discord message
// that stores the file. Existing premium/account data lives elsewhere and is
// untouched.

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
    // Discord-backed content: one row per successful Discord message, so the
    // app can list, play and delete content without re-asking Discord.
    await sql`create table if not exists xs_discord_media (
      id text primary key,
      title text not null,
      description text not null default '',
      filename text not null default '',
      bytes bigint not null default 0,
      mime_type text not null default 'application/octet-stream',
      kind text not null default 'file',
      discord_guild_id text not null,
      discord_channel_id text not null,
      discord_message_id text not null,
      attachment_url text not null default '',
      access_role text not null default 'premium',
      status text not null default 'ready',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`
    // Transient chunks while a large file travels from the browser to the
    // backend (Vercel caps a single request body at ~4.5MB). Assembled at
    // finish, then uploaded to Discord and removed.
    await sql`create table if not exists xs_discord_chunks (upload_id text not null, idx integer not null, bytes bytea not null, created_at timestamptz not null default now(), primary key (upload_id, idx))`
  })()
  return ready
}
