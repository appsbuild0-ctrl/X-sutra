// In-memory replacement for netlify/functions/_server/database.mjs.
//
// Same exported surface and the same semantics as the real module (auth row
// merge rules, OTP throttling, channel upsert that keeps published/access_role)
// but with no PostgreSQL, so scripts/verify-telegram-login.mjs can drive the
// real login handler end to end.

const store = () => (globalThis.__fakeDb ??= { auth: null, rate: new Map(), channels: new Map() })

export function __reset() { globalThis.__fakeDb = { auth: null, rate: new Map(), channels: new Map() } }
export function __store() { return store() }

export function db() {
  return (strings) => {
    const text = strings.join('?')
    // The only read query the Telegram endpoints issue is the Premium channel
    // list in netlify/functions/telegram-channels.mjs.
    if (/from xs_channels/.test(text)) {
      return Promise.resolve([...store().channels.values()].map((row) => ({
        id: row.id,
        title: row.title,
        avatar: row.avatar ?? null,
        category: row.category,
        access_role: row.access_role ?? 'premium',
        updated_at: new Date().toISOString(),
        media_count: 0,
        latest_at: null
      })))
    }
    throw new Error(`fake database: unsupported query — ${text.slice(0, 80)}`)
  }
}

export async function ensureSchema() { return true }

/** Same bootstrap rule as the real module: TELEGRAM_ADMIN_IDS seeds admins. */
export function seededAdminIds() {
  return String(process.env.TELEGRAM_ADMIN_IDS || '')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => /^\d{1,20}$/.test(value))
}

// Real rules: one code per minute, five per hour, per caller.
export async function assertOtpRateLimit(caller) {
  const key = `otp:${String(caller || 'unknown').slice(0, 64)}`
  const now = Date.now()
  const row = store().rate.get(key)
  if (row) {
    if (now - row.last_at < 60_000) throw Object.assign(new Error('A code was just sent. Wait a minute before requesting another.'), { statusCode: 429 })
    const inWindow = now - row.window_start < 3_600_000
    const count = inWindow ? row.count + 1 : 1
    if (inWindow && count > 5) throw Object.assign(new Error('Too many codes requested this hour. Try again later.'), { statusCode: 429 })
    store().rate.set(key, { last_at: now, count, window_start: inWindow ? row.window_start : now })
  } else {
    store().rate.set(key, { last_at: now, count: 1, window_start: now })
  }
}

export async function upsertChannels(rows) {
  const list = Array.isArray(rows) ? rows : []
  for (const row of list) {
    const existing = store().channels.get(String(row.id))
    store().channels.set(String(row.id), {
      ...existing,
      id: String(row.id),
      title: String(row.title),
      avatar: row.avatar ?? existing?.avatar ?? null,
      category: String(row.category),
      access_role: existing?.access_role ?? 'premium',
      published: existing?.published ?? true
    })
  }
  return list.length
}

export async function authState() {
  return store().auth ? { ...store().auth } : null
}

export async function saveAuth(patch) {
  const current = store().auth
  // Same semantics as the real module: an explicit null in the patch clears
  // the column instead of keeping the stored value.
  const pick = (key, fallback) => (key in patch ? patch[key] : current?.[key] ?? fallback)
  const next = {
    encrypted_session: pick('encrypted_session', ''),
    phone_code_hash: pick('phone_code_hash', null),
    status: pick('status', 'pending'),
    telegram_user_id: pick('telegram_user_id', null),
    updated_at: new Date().toISOString()
  }
  store().auth = next
  return { ...next }
}
