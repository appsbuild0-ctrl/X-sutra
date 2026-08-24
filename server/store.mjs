import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/**
 * Media metadata store. Only references are kept here — never the actual bytes.
 * The actual files live in the private Telegram storage chat.
 *
 * Default: a JSON file under XSUTRA_DATA_DIR (works in local dev and on any
 * Node host with a writable filesystem). On Netlify you can opt into Netlify
 * Blobs (a host-provided store, not a third-party provider) by installing
 * `@netlify/blobs` and setting XSUTRA_STORE=blobs; if that is unavailable the
 * file store is used transparently.
 */

export function createStore(config) {
  if ((process.env.XSUTRA_STORE || '').toLowerCase() === 'blobs') {
    try {
      return createBlobStore()
    } catch (error) {
      console.warn('[store] Netlify Blobs unavailable, falling back to file store:', error?.message)
    }
  }
  return createFileStore(config.dataDir)
}

function createFileStore(dataDir) {
  const file = join(dataDir, 'media-store.json')
  let writeChain = Promise.resolve()

  async function ensure() {
    await fs.mkdir(dataDir, { recursive: true })
    try {
      await fs.access(file)
    } catch {
      await fs.writeFile(file, '[]', 'utf8')
    }
  }

  async function readAll() {
    await ensure()
    const raw = await fs.readFile(file, 'utf8')
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  async function writeAll(items) {
    // Serialize writes so concurrent admin uploads/deletes don't clobber each other.
    const run = writeChain.then(async () => {
      await ensure()
      await fs.writeFile(file, JSON.stringify(items, null, 2), 'utf8')
    })
    writeChain = run.catch(() => {})
    return run
  }

  return {
    storeKind: 'file',
    async list() {
      const items = await readAll()
      return items.slice().sort((a, b) => b.createdAt - a.createdAt)
    },
    async get(id) {
      const items = await readAll()
      return items.find((item) => item.id === id) ?? null
    },
    async create(record) {
      const items = await readAll()
      items.push(record)
      await writeAll(items)
      return record
    },
    async remove(id) {
      const items = await readAll()
      const next = items.filter((item) => item.id !== id)
      await writeAll(next)
      return next.length !== items.length
    }
  }
}

function createBlobStore() {
  // Lazy require so the dependency is only needed when explicitly enabled.
  const require = createRequire(import.meta.url)
  const { getStore } = require('@netlify/blobs')
  const store = getStore({ name: 'xsutra-media', siteID: process.env.SITE_ID })
  const KEY = 'media-index'

  async function readAll() {
    const raw = await store.get(KEY, { type: 'text' })
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  async function writeAll(items) {
    await store.set(KEY, JSON.stringify(items, null, 2))
  }

  return {
    storeKind: 'blobs',
    async list() {
      const items = await readAll()
      return items.slice().sort((a, b) => b.createdAt - a.createdAt)
    },
    async get(id) {
      const items = await readAll()
      return items.find((item) => item.id === id) ?? null
    },
    async create(record) {
      const items = await readAll()
      items.push(record)
      await writeAll(items)
      return record
    },
    async remove(id) {
      const items = await readAll()
      const next = items.filter((item) => item.id !== id)
      await writeAll(next)
      return next.length !== items.length
    }
  }
}
