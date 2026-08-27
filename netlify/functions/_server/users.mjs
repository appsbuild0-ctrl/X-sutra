// X-Sutra accounts backed by Telegram Login Widget identities.
//
// The Telegram user id is the only identifier. Nothing secret about the user is
// stored: no password, no OTP, no MTProto session string — the widget only ever
// hands over public profile fields plus a signed hash (see telegramLogin.mjs).

import { db, ensureSchema, seededAdminIds } from './database.mjs'
import { requireUser } from './security.mjs'

const userId = (telegramId) => `tg:${String(telegramId)}`

export async function findUserByTelegramId(telegramId) {
  await ensureSchema()
  const rows = await db()`select * from xs_users where telegram_id=${String(telegramId)} limit 1`
  return rows[0] || null
}

export async function findUserById(id) {
  await ensureSchema()
  const rows = await db()`select * from xs_users where id=${String(id)} limit 1`
  return rows[0] || null
}

export async function isAdminTelegramId(telegramId) {
  await ensureSchema()
  const id = String(telegramId)
  if (seededAdminIds().includes(id)) return true
  const rows = await db()`select telegram_id from xs_admin_telegram_ids where telegram_id=${id} limit 1`
  return rows.length > 0
}

/**
 * Create or refresh the account for a verified Telegram identity.
 *
 * Role is derived server-side: an id in xs_admin_telegram_ids (or seeded from
 * TELEGRAM_ADMIN_IDS) is an admin, everybody else keeps whatever membership role
 * they were given (premium/vip) or stays 'normal'. The client has no say.
 *
 * Bootstrap: when literally nobody is an admin yet (no env seed and an empty
 * admin table), the first Telegram account to log in becomes the owner-admin.
 * This closes the "must already be admin to add the first admin" dead-end
 * without ever putting a real id in the code; the id lands in the database, not
 * the bundle. Once a single admin exists the door shuts for good.
 */
export async function upsertTelegramUser(identity) {
  await ensureSchema()
  const telegramId = String(identity.id)
  const someAdmin = (await listAdmins()).length > 0
  const admin = someAdmin ? await isAdminTelegramId(telegramId) : true
  if (!someAdmin) {
    await db()`insert into xs_admin_telegram_ids (telegram_id, label) values (${telegramId}, 'first-login bootstrap') on conflict (telegram_id) do nothing`
  }
  const current = await findUserByTelegramId(telegramId)
  // Demotion must work: an id removed from the admin list loses admin on the
  // next login, but a manually granted premium/vip role is never overwritten.
  const previous = current?.role || 'normal'
  const role = admin ? 'admin' : (previous === 'admin' ? 'normal' : previous)
  const firstName = String(identity.firstName || '').slice(0, 64)
  const lastName = String(identity.lastName || '').slice(0, 64)
  const username = String(identity.username || '').slice(0, 32)
  const photoUrl = String(identity.photoUrl || '').slice(0, 512)
  await ensureSchema()
  const rows = await db()`
    insert into xs_users (id, telegram_id, first_name, last_name, username, photo_url, role)
    values (${userId(telegramId)}, ${telegramId}, ${firstName}, ${lastName}, ${username}, ${photoUrl}, ${role})
    on conflict (telegram_id) do update set
      first_name=excluded.first_name,
      last_name=excluded.last_name,
      username=excluded.username,
      photo_url=case when excluded.photo_url = '' then xs_users.photo_url else excluded.photo_url end,
      role=excluded.role,
      updated_at=now()
    returning *`
  return rows[0] || null
}

export async function setUserRole(telegramId, role) {
  await ensureSchema()
  const allowed = ['normal', 'creator', 'premium', 'vip', 'admin']
  if (!allowed.includes(String(role))) throw Object.assign(new Error(`Role must be one of: ${allowed.join(', ')}.`), { statusCode: 400 })
  const rows = await db()`update xs_users set role=${String(role)}, updated_at=now() where telegram_id=${String(telegramId)} returning *`
  if (!rows[0]) throw Object.assign(new Error(`No X-Sutra account has logged in with Telegram id ${telegramId} yet.`), { statusCode: 404 })
  return rows[0]
}

export async function setUserStatus(telegramId, status) {
  await ensureSchema()
  const next = status === 'off' ? 'off' : 'on'
  const rows = await db()`update xs_users set status=${next}, updated_at=now() where telegram_id=${String(telegramId)} returning *`
  if (!rows[0]) throw Object.assign(new Error(`No X-Sutra account has logged in with Telegram id ${telegramId} yet.`), { statusCode: 404 })
  return rows[0]
}

/** Server-side logout: every JWT issued before this moment stops working. */
export async function revokeUserSessions(telegramId) {
  await ensureSchema()
  await db()`update xs_users set session_revoked_at=now(), updated_at=now() where telegram_id=${String(telegramId)}`
  return true
}

export async function listUsers() {
  await ensureSchema()
  const rows = await db()`select id, telegram_id, first_name, last_name, username, photo_url, role, status, created_at from xs_users order by created_at desc limit 200`
  return rows.map(publicUser)
}

/** Shape sent to the browser — never includes internal columns. */
export function publicUser(row) {
  if (!row) return null
  return {
    id: String(row.id),
    telegramId: String(row.telegram_id),
    name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.username || `Telegram ${String(row.telegram_id).slice(-4)}`,
    username: String(row.username || ''),
    photoUrl: String(row.photo_url || ''),
    role: String(row.role || 'normal'),
    status: String(row.status || 'on'),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || '')
  }
}

// ---------------------------------------------------------------------------
// Admin list (managed from the admin panel, seeded from TELEGRAM_ADMIN_IDS)
// ---------------------------------------------------------------------------

export async function listAdmins() {
  await ensureSchema()
  const rows = await db()`select telegram_id, label, created_at from xs_admin_telegram_ids order by created_at asc`
  const fromTable = rows.map((row) => ({ telegramId: String(row.telegram_id), label: String(row.label || ''), createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || '') }))
  const seeded = seededAdminIds().filter((id) => !fromTable.some((row) => row.telegramId === id)).map((id) => ({ telegramId: id, label: 'TELEGRAM_ADMIN_IDS', createdAt: '' }))
  return [...seeded, ...fromTable]
}

export async function addAdmin(telegramId, label = '') {
  await ensureSchema()
  const id = String(telegramId || '').trim()
  if (!/^\d{1,20}$/.test(id)) throw Object.assign(new Error('An admin Telegram id must be numeric (find it with @userinfobot).'), { statusCode: 400 })
  await db()`insert into xs_admin_telegram_ids (telegram_id, label) values (${id}, ${String(label || '').slice(0, 60)}) on conflict (telegram_id) do update set label=excluded.label`
  // Promote an existing account immediately so the next request is already admin.
  const existing = await findUserByTelegramId(id)
  if (existing) await setUserRole(id, 'admin')
  return listAdmins()
}

export async function removeAdmin(telegramId) {
  await ensureSchema()
  const id = String(telegramId || '').trim()
  if (seededAdminIds().includes(id)) throw Object.assign(new Error(`${id} comes from the TELEGRAM_ADMIN_IDS environment variable — remove it there (a database row cannot override the env seed).`), { statusCode: 400 })
  await db()`delete from xs_admin_telegram_ids where telegram_id=${id}`
  const existing = await findUserByTelegramId(id)
  if (existing?.role === 'admin') await setUserRole(id, 'normal')
  return listAdmins()
}

// ---------------------------------------------------------------------------
// Request gates. The JWT says who the caller claims to be; the database decides
// what that account may still do, so removing an admin id or disabling an
// account takes effect immediately — not when the token expires.
// ---------------------------------------------------------------------------

export async function requireActiveUser(event) {
  const claim = await requireUser(event)
  const row = await findUserByTelegramId(claim.telegramId)
  if (!row) throw Object.assign(new Error('This Telegram account has no X-Sutra session — sign in again.'), { statusCode: 401 })
  if (row.status === 'off') throw Object.assign(new Error('This X-Sutra account is disabled.'), { statusCode: 403 })
  const issuedAt = Number(claim.iat || 0)
  if (row.session_revoked_at) {
    const at = row.session_revoked_at instanceof Date ? row.session_revoked_at : new Date(row.session_revoked_at)
    if (issuedAt < Math.floor(at.getTime() / 1000)) throw Object.assign(new Error('Signed out — sign in with Telegram again.'), { statusCode: 401 })
  }
  return { ...claim, role: String(row.role || 'normal'), user: publicUser(row) }
}

export async function requireAdminUser(event) {
  const session = await requireActiveUser(event)
  if (session.role !== 'admin') throw Object.assign(new Error('Only an admin Telegram account can do this.'), { statusCode: 403 })
  return session
}

/** Role of the caller if a valid session is attached, else 'normal' (public read). */
export async function optionalRole(event) {
  try {
    const session = await requireActiveUser(event)
    return session.role
  } catch {
    return 'normal'
  }
}
