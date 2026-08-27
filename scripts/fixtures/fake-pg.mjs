// In-memory `postgres` driver used only by scripts/verify-discord.mjs. The real
// SQL statements from netlify/functions/_server/{database,discordMedia}.mjs are
// issued; only the storage is replaced. No PostgreSQL and no network needed.

const now = () => new Date().toISOString()

export function __reset() {
  globalThis.__fakePg = { media: [], chunks: [] }
}
export function __store() {
  return (globalThis.__fakePg ??= { media: [], chunks: [] })
}

export default function postgres() {
  return (strings, ...params) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim()
    const store = __store()

    if (/^create table/i.test(query)) return Promise.resolve([])

    if (/^insert into xs_discord_media/i.test(query)) {
      const [id, title, description, filename, bytes, mime, kind, guild, channel, message, attachment, accessRole] = params
      const existing = store.media.find((r) => r.id === id)
      const row = {
        id, title, description, filename, bytes: Number(bytes), mime_type: mime, kind,
        discord_guild_id: guild, discord_channel_id: channel, discord_message_id: message,
        attachment_url: attachment, access_role: accessRole, status: 'ready',
        created_at: now(), updated_at: now()
      }
      if (existing) Object.assign(existing, row, { created_at: existing.created_at })
      else store.media.push(row)
      return Promise.resolve([existing || row])
    }
    if (/^select \* from xs_discord_media where id=\?/i.test(query)) {
      return Promise.resolve(store.media.filter((r) => r.id === String(params[0])))
    }
    if (/^select \* from xs_discord_media/i.test(query)) {
      const readyOnly = /where status='ready'/i.test(query)
      return Promise.resolve([...store.media].reverse().filter((r) => !readyOnly || r.status === 'ready'))
    }
    if (/^update xs_discord_media set status='deleted'/i.test(query)) {
      const row = store.media.find((r) => r.id === String(params[0]))
      if (row) { row.status = 'deleted'; row.updated_at = now() }
      return Promise.resolve([row])
    }

    if (/^insert into xs_discord_chunks/i.test(query)) {
      const [uploadId, idx, bytes] = params
      const existing = store.chunks.find((r) => r.upload_id === uploadId && r.idx === Number(idx))
      if (existing) existing.bytes = bytes
      else store.chunks.push({ upload_id: uploadId, idx: Number(idx), bytes })
      return Promise.resolve([])
    }
    if (/^select count\(\*\)::int n from xs_discord_chunks/i.test(query)) {
      return Promise.resolve([{ n: store.chunks.filter((r) => r.upload_id === String(params[0])).length }])
    }
    if (/^select idx, bytes from xs_discord_chunks/i.test(query)) {
      return Promise.resolve(store.chunks.filter((r) => r.upload_id === String(params[0])).sort((a, b) => a.idx - b.idx))
    }
    if (/^delete from xs_discord_chunks/i.test(query)) {
      store.chunks = store.chunks.filter((r) => r.upload_id !== String(params[0]))
      return Promise.resolve([])
    }

    return Promise.reject(new Error(`fake pg: unsupported query — ${query.slice(0, 90)}`))
  }
}
