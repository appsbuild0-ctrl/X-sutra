// In-memory stand-in for the `postgres` driver, used by
// scripts/verify-telegram-widget.mjs.
//
// Only the driver is replaced: netlify/functions/_server/database.mjs, users.mjs
// and uploads.mjs all run for real — real schema DDL, real role checks, real
// chunk bookkeeping, real byte-range maths. The queries matched below are the
// exact ones those modules issue (including postgres.js nested fragments, which
// is how the conditional UPDATE columns are composed).
//
// No PostgreSQL server and no network are needed.

const now = () => new Date().toISOString()

export function __reset() {
  globalThis.__fakeNeon = { users: [], admins: [], uploads: [], chunks: [], channels: [], sql: [] }
  // database.ensureSchema() is memoised per process, so re-seed what the real
  // bootstrap would have seeded from TELEGRAM_ADMIN_IDS.
  for (const telegramId of seededAdminIds()) {
    __store().admins.push({ telegram_id: telegramId, label: 'TELEGRAM_ADMIN_IDS', created_at: now() })
  }
}

export function __store() {
  return (globalThis.__fakeNeon ??= { users: [], admins: [], uploads: [], chunks: [], channels: [], sql: [] })
}

export function seededAdminIds() {
  return String(process.env.TELEGRAM_ADMIN_IDS || '')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => /^\d{1,20}$/.test(value))
}

function upsert(list, match, row) {
  const index = list.findIndex(match)
  if (index >= 0) list[index] = { ...list[index], ...row }
  else list.push(row)
  return list.find(match)
}

const FRAGMENT = '\u0000'

function driver() {
  const sql = (strings, ...values) => {
    // ---- compose, expanding nested fragments the way postgres.js does -------
    let composed = ''
    const params = []
    strings.forEach((part, index) => {
      composed += part
      if (index >= values.length) return
      const value = values[index]
      if (value && value.__fragment) {
        composed += value.text
        params.push(...value.values)
      } else {
        composed += FRAGMENT
        params.push(value)
      }
    })

    const flat = composed.replace(/\s+/g, ' ').trim()

    // A bare fragment (",title=?" or "") is never executed on its own.
    if (flat === '' || new RegExp(`^,[\\w_]+=${FRAGMENT}$`).test(flat)) {
      return { __fragment: true, text: flat, values: params }
    }

    const query = flat.split(FRAGMENT).join('?')
    __store().sql.push(query.slice(0, 80))
    const store = __store()

    if (/^create table/i.test(query)) return Promise.resolve([])

    // ---- xs_users ----------------------------------------------------------
    if (/^insert into xs_users/i.test(query)) {
      const [id, telegramId, firstName, lastName, username, photoUrl, role] = params
      const existing = store.users.find((row) => row.telegram_id === telegramId)
      const row = existing
        ? {
          ...existing,
          first_name: firstName,
          last_name: lastName,
          username,
          photo_url: photoUrl === '' ? existing.photo_url : photoUrl,
          role,
          updated_at: now()
        }
        : {
          id, telegram_id: telegramId, first_name: firstName, last_name: lastName, username, photo_url: photoUrl,
          role, status: 'on', session_revoked_at: null, created_at: now(), updated_at: now()
        }
      return Promise.resolve([upsert(store.users, (r) => r.telegram_id === telegramId, row)])
    }
    if (/^select .* from xs_users where telegram_id=\?/i.test(query)) {
      return Promise.resolve(store.users.filter((row) => row.telegram_id === String(params[0])))
    }
    if (/^select .* from xs_users where id=\?/i.test(query)) {
      return Promise.resolve(store.users.filter((row) => row.id === String(params[0])))
    }
    if (/^update xs_users set role=\?/i.test(query)) {
      const row = store.users.find((r) => r.telegram_id === String(params[1]))
      if (!row) return Promise.resolve([])
      row.role = String(params[0]); row.updated_at = now()
      return Promise.resolve([row])
    }
    if (/^update xs_users set status=\?/i.test(query)) {
      const row = store.users.find((r) => r.telegram_id === String(params[1]))
      if (!row) return Promise.resolve([])
      row.status = String(params[0]); row.updated_at = now()
      return Promise.resolve([row])
    }
    if (/^update xs_users set session_revoked_at=now\(\)/i.test(query)) {
      const row = store.users.find((r) => r.telegram_id === String(params[0]))
      if (row) { row.session_revoked_at = new Date(); row.updated_at = now() }
      return Promise.resolve([])
    }
    if (/^select .* from xs_users order by created_at/i.test(query)) {
      return Promise.resolve([...store.users].reverse().slice(0, 200))
    }

    // ---- xs_admin_telegram_ids ---------------------------------------------
    if (/^insert into xs_admin_telegram_ids/i.test(query)) {
      const [telegramId, label] = params
      upsert(store.admins, (row) => row.telegram_id === telegramId, { telegram_id: telegramId, label, created_at: now() })
      return Promise.resolve([])
    }
    if (/^delete from xs_admin_telegram_ids/i.test(query)) {
      store.admins = store.admins.filter((row) => row.telegram_id !== String(params[0]))
      return Promise.resolve([])
    }
    if (/^select .* from xs_admin_telegram_ids where telegram_id=\?/i.test(query)) {
      return Promise.resolve(store.admins.filter((row) => row.telegram_id === String(params[0])))
    }
    if (/^select .* from xs_admin_telegram_ids order by/i.test(query)) {
      return Promise.resolve([...store.admins])
    }

    // ---- xs_uploads ---------------------------------------------------------
    if (/^insert into xs_uploads/i.test(query)) {
      const [id, kind, title, category, thumbnail, mimeType, filename, size, chunkSize, chunks, accessRole, published, ownerTelegramId] = params
      store.uploads.push({
        id, kind, title, category, thumbnail, mime_type: mimeType, filename, bytes: Number(size),
        chunk_size: Number(chunkSize), chunks: Number(chunks), status: 'pending', access_role: accessRole,
        published: Boolean(published), owner_telegram_id: ownerTelegramId, created_at: now(), updated_at: now()
      })
      return Promise.resolve([])
    }
    if (/^select .* from xs_uploads where id=\?/i.test(query)) {
      return Promise.resolve(store.uploads.filter((row) => row.id === String(params[0])))
    }
    if (/^update xs_uploads set/i.test(query)) {
      const id = String(params[params.length - 1])
      const row = store.uploads.find((upload) => upload.id === id)
      if (!row) return Promise.resolve([])
      // The composed fragments tell us which columns were supplied, in order.
      const keys = ['title', 'category', 'thumbnail', 'published', 'access_role'].filter((key) => query.includes(`,${key}=?`))
      keys.forEach((key, index) => { row[key] = params[index] })
      if (/set status='ready'/i.test(query)) row.status = 'ready'
      row.updated_at = now()
      return Promise.resolve([row])
    }
    if (/^delete from xs_uploads/i.test(query)) {
      const id = String(params[0])
      store.uploads = store.uploads.filter((row) => row.id !== id)
      store.chunks = store.chunks.filter((row) => row.upload_id !== id)
      return Promise.resolve([])
    }
    if (/group by category/i.test(query)) {
      const totals = new Map()
      for (const row of store.uploads.filter((upload) => upload.status === 'ready')) {
        totals.set(row.category, (totals.get(row.category) || 0) + 1)
      }
      return Promise.resolve([...totals.entries()].map(([category, total]) => ({ category, total })))
    }
    if (/^select .* from xs_uploads (where .* )?order by created_at desc limit 500/i.test(query)) {
      const readyOnly = /where status='ready'/i.test(query)
      return Promise.resolve(
        [...store.uploads].reverse().filter((row) => !readyOnly || (row.status === 'ready' && row.published)).slice(0, 500)
      )
    }

    // ---- xs_channels ------------------------------------------------------
    if (/^insert into xs_channels/i.test(query)) {
      const conflictUpdate = /on conflict \(id\) do update/i.test(query)
      const id = String(params[0])
      const existing = store.channels.find((row) => row.id === id)
      if (existing && !conflictUpdate) return Promise.resolve([]) // do nothing
      const full = {
        id,
        title: String(params[1]),
        avatar: params[2] ?? null,
        category: String(params[3]),
        access_role: params.length > 4 ? String(params[4]) : (existing?.access_role || 'premium'),
        published: params.length > 5 ? Boolean(params[5]) : (existing?.published ?? true),
        media_count: 0,
        updated_at: now()
      }
      if (existing && conflictUpdate) Object.assign(existing, { title: full.title, category: full.category, updated_at: now() })
      else if (!existing) store.channels.push(full)
      return Promise.resolve([])
    }
    if (/^delete from xs_channels/i.test(query)) {
      store.channels = store.channels.filter((row) => row.id !== String(params[0]))
      return Promise.resolve([])
    }
    if (/^select id from xs_channels where id=\?/i.test(query)) {
      return Promise.resolve(store.channels.filter((row) => row.id === String(params[0])))
    }
    if (/^update xs_channels set/i.test(query)) {
      const id = String(params[params.length - 1])
      const row = store.channels.find((upload) => upload.id === id)
      if (!row) return Promise.resolve([])
      const keys = ['title', 'category', 'access_role', 'published'].filter((key) => query.includes(`,${key}=?`))
      keys.forEach((key, index) => { row[key] = params[index] })
      row.updated_at = now()
      return Promise.resolve([row])
    }
    if (/^select \* from xs_channels (where .* )?order by updated_at desc limit 500/i.test(query)) {
      const publishedOnly = /where published=true/i.test(query)
      return Promise.resolve([...store.channels].reverse().filter((row) => !publishedOnly || row.published).slice(0, 500))
    }

    // ---- xs_upload_chunks ---------------------------------------------------
    if (/^insert into xs_upload_chunks/i.test(query)) {
      const [uploadId, idx, bytes] = params
      upsert(store.chunks, (row) => row.upload_id === uploadId && row.idx === idx, { upload_id: uploadId, idx: Number(idx), bytes })
      return Promise.resolve([])
    }
    if (/coalesce\(sum\(octet_length\(bytes\)\)/i.test(query)) {
      const chunks = store.chunks.filter((row) => row.upload_id === String(params[0]))
      return Promise.resolve([{ received: chunks.length, stored: chunks.reduce((sum, row) => sum + row.bytes.length, 0) }])
    }
    if (/count\(\*\)::int received from xs_upload_chunks/i.test(query)) {
      return Promise.resolve([{ received: store.chunks.filter((row) => row.upload_id === String(params[0])).length }])
    }
    if (/^select idx, bytes from xs_upload_chunks where upload_id=\? and idx between/i.test(query)) {
      const [uploadId, from, to] = params
      return Promise.resolve(
        store.chunks
          .filter((row) => row.upload_id === String(uploadId) && row.idx >= Number(from) && row.idx <= Number(to))
          .sort((a, b) => a.idx - b.idx)
      )
    }

    return Promise.reject(new Error(`fake neon: unsupported query — ${query.slice(0, 100)}`))
  }
  return sql
}

export function db() {
  return driver()
}

// `import postgres from 'postgres'` in database.mjs — this is the replacement.
export default function postgres(_connectionString, _options) {
  return driver()
}
