import type { MediaItem } from '../types'

/**
 * Client for the secure Telegram-backed media backend.
 *
 * IMPORTANT: this module NEVER sees the Telegram bot token or chat id. Those
 * live only in server-side environment variables. The browser only talks to
 * same-origin /api endpoints, and mutating endpoints require an HttpOnly admin
 * session cookie that the backend issues after a password check.
 */

const BASE = '/api'

class StudioApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'StudioApiError'
  }
}

async function parseError(res: Response): Promise<StudioApiError> {
  let message = `Request failed (${res.status})`
  try {
    const data = (await res.json()) as { error?: string }
    if (data?.error) message = data.error
  } catch {
    /* ignore */
  }
  return new StudioApiError(message, res.status)
}

export const studioApi = {
  async listMedia(): Promise<MediaItem[]> {
    const res = await fetch(`${BASE}/media`, { credentials: 'include' })
    if (!res.ok) throw await parseError(res)
    const data = (await res.json()) as { items: MediaItem[] }
    return data.items ?? []
  },

  async getMedia(id: string): Promise<MediaItem> {
    const res = await fetch(`${BASE}/media/${encodeURIComponent(id)}`, { credentials: 'include' })
    if (!res.ok) throw await parseError(res)
    return (await res.json()) as MediaItem
  },

  async session(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE}/admin/session`, { credentials: 'include' })
      if (!res.ok) return false
      const data = (await res.json()) as { admin: boolean }
      return Boolean(data.admin)
    } catch {
      return false
    }
  },

  async login(password: string): Promise<boolean> {
    const res = await fetch(`${BASE}/admin/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    })
    if (!res.ok) throw await parseError(res)
    const data = (await res.json()) as { admin: boolean }
    return Boolean(data.admin)
  },

  async logout(): Promise<void> {
    await fetch(`${BASE}/admin/logout`, { method: 'POST', credentials: 'include' })
  },

  /** Uploads a file with real progress reporting via XMLHttpRequest. */
  uploadMedia(
    file: File,
    options: { title?: string; caption?: string; onProgress?: (fraction: number) => void } = {}
  ): Promise<MediaItem> {
    return new Promise<MediaItem>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${BASE}/media/upload`)
      xhr.withCredentials = true
      if (options.onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) options.onProgress?.(event.loaded / event.total)
        }
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as MediaItem)
          } catch {
            reject(new StudioApiError('Upload succeeded but the response was unreadable.', xhr.status))
          }
          return
        }
        let message = `Upload failed (${xhr.status})`
        try {
          const data = JSON.parse(xhr.responseText) as { error?: string }
          if (data?.error) message = data.error
        } catch {
          /* ignore */
        }
        reject(new StudioApiError(message, xhr.status))
      }
      xhr.onerror = () => reject(new StudioApiError('Network error during upload.', 0))
      xhr.onabort = () => reject(new StudioApiError('Upload cancelled.', 0))
      const form = new FormData()
      form.append('file', file, file.name)
      if (options.title) form.append('title', options.title)
      if (options.caption) form.append('caption', options.caption)
      xhr.send(form)
    })
  },

  async deleteMedia(id: string): Promise<void> {
    const res = await fetch(`${BASE}/media/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    if (!res.ok) throw await parseError(res)
  }
}

export { StudioApiError }
