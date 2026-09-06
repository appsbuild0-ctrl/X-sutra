import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const LOCAL_DIR = process.env.PREMIUM_MEDIA_DIR || (process.env.PREMIUM_LOCAL_FILE ? '.premium-media' : '')

function safeId(id) {
  const clean = String(id || '').replace(/[^a-zA-Z0-9._-]/g, '')
  if (!clean || clean.length > 80) throw new Error('Invalid media id')
  return clean
}

async function blobStore() {
  const { getStore } = await import('@netlify/blobs')
  return getStore('premium-files')
}

export async function writeFileBytes(id, bytes, contentType, filename) {
  const key = safeId(id)
  const meta = { contentType: contentType || 'application/octet-stream', filename: filename || key }
  if (LOCAL_DIR) {
    await mkdir(LOCAL_DIR, { recursive: true })
    await writeFile(resolve(LOCAL_DIR, key), Buffer.from(bytes))
    await writeFile(resolve(LOCAL_DIR, `${key}.json`), JSON.stringify(meta), 'utf8')
    return meta
  }
  const store = await blobStore()
  await store.set(key, Buffer.from(bytes), { metadata: meta })
  return meta
}

export async function readFileRecord(id) {
  const key = safeId(id)
  if (LOCAL_DIR) {
    const path = resolve(LOCAL_DIR, key)
    if (!existsSync(path)) return null
    const bytes = await readFile(path)
    let meta = { contentType: 'application/octet-stream', filename: key }
    try {
      meta = JSON.parse(await readFile(resolve(LOCAL_DIR, `${key}.json`), 'utf8'))
    } catch { /* default */ }
    return { bytes, ...meta }
  }
  const store = await blobStore()
  const entry = await store.getWithMetadata(key, { type: 'arrayBuffer' })
  if (!entry?.data) return null
  return {
    bytes: Buffer.from(entry.data),
    contentType: entry.metadata?.contentType || 'application/octet-stream',
    filename: entry.metadata?.filename || key
  }
}

export async function writeChunk(id, index, data) {
  const key = safeId(id)
  if (LOCAL_DIR) {
    await mkdir(LOCAL_DIR, { recursive: true })
    await writeFile(resolve(LOCAL_DIR, `${key}.part.${index}`), Buffer.from(data))
    return
  }
  const store = await blobStore()
  await store.set(`${key}.part.${index}`, Buffer.from(data))
}

export async function assembleChunks(id, total, contentType, filename) {
  const key = safeId(id)
  const parts = []
  if (LOCAL_DIR) {
    for (let index = 0; index < total; index += 1) {
      const path = resolve(LOCAL_DIR, `${key}.part.${index}`)
      if (!existsSync(path)) throw new Error(`Missing chunk ${index}`)
      parts.push(await readFile(path))
    }
    const bytes = Buffer.concat(parts)
    await writeFileBytes(key, bytes, contentType, filename)
    for (let index = 0; index < total; index += 1) {
      await rm(resolve(LOCAL_DIR, `${key}.part.${index}`), { force: true })
    }
    return bytes.length
  }
  const store = await blobStore()
  for (let index = 0; index < total; index += 1) {
    const chunk = await store.get(`${key}.part.${index}`, { type: 'arrayBuffer' })
    if (!chunk) throw new Error(`Missing chunk ${index}`)
    parts.push(Buffer.from(chunk))
  }
  const bytes = Buffer.concat(parts)
  await writeFileBytes(key, bytes, contentType, filename)
  for (let index = 0; index < total; index += 1) {
    await store.delete(`${key}.part.${index}`)
  }
  return bytes.length
}
