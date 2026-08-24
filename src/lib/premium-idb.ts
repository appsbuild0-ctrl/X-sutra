const DB = 'x-sutra-premium-files'
const STORE = 'files'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function idbPutFile(id: string, file: File): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(file, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function idbGetFile(id: string): Promise<File | null> {
  const db = await openDb()
  const file = await new Promise<File | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(id)
    request.onsuccess = () => resolve((request.result as File | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return file
}

const blobCache = new Map<string, string>()

export async function resolvePremiumSrc(url: string): Promise<string> {
  if (!url.startsWith('idb:')) return url
  const cached = blobCache.get(url)
  if (cached) return cached
  const file = await idbGetFile(url.slice(4))
  if (!file) return url
  const objectUrl = URL.createObjectURL(file)
  blobCache.set(url, objectUrl)
  return objectUrl
}
