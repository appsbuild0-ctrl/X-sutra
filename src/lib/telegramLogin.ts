// Client side of "Login with Telegram" + admin uploads.
//
// Security notes:
//   * TELEGRAM_BOT_TOKEN never reaches this bundle. The only thing the browser
//     learns is the bot's public @username (it is part of the widget's own URL)
//     and that comes from GET /api/auth/telegram.
//   * The widget payload is signed by Telegram and verified on the server; this
//     module never trusts its own copy of the user id for anything privileged.
//   * Only the signed X-Sutra JWT is stored on the device, under its own key.

import type { MediaItem, UserRole } from '../types'
import { readStored, removeStored, writeStored } from './storage'

const AUTH_ENDPOINT = '/api/auth/telegram'
const UPLOAD_ENDPOINT = '/api/uploads'
const SESSION_KEY = 'x-sutra.user.session.v1'

export class TelegramLoginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TelegramLoginError'
  }
}

/** The object telegram.org's widget hands to data-onauth. */
export interface TelegramWidgetUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

export interface AppUser {
  id: string
  telegramId: string
  name: string
  username: string
  photoUrl: string
  role: UserRole
  status: 'on' | 'off'
  createdAt: string
}

export interface UserSession {
  token: string
  user: AppUser
  expiresAt?: string
}

export interface TelegramLoginConfig {
  enabled: boolean
  botUsername: string
  botName: string
  error?: string
}

export interface AdminEntry {
  telegramId: string
  label: string
  createdAt: string
}

export interface UploadRecord {
  id: string
  kind: 'video' | 'image' | 'audio' | 'file'
  title: string
  category: string
  thumbnail: string
  mimeType: string
  filename: string
  bytes: number
  status: 'pending' | 'ready'
  accessRole: 'public' | 'premium' | 'vip' | 'admin'
  published: boolean
  url: string
  createdAt: string
}

export interface UploadCategory {
  category: string
  total: number
}

// ---------------------------------------------------------------------------
// Session storage
// ---------------------------------------------------------------------------

export function readUserSession(): UserSession | null {
  const session = readStored<UserSession | null>(SESSION_KEY, null)
  if (!session?.token || !session?.user) return null
  if (session.expiresAt && Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) <= Date.now()) {
    clearUserSession()
    return null
  }
  return session
}

export function writeUserSession(session: UserSession): void {
  writeStored(SESSION_KEY, session)
}

export function clearUserSession(): void {
  removeStored(SESSION_KEY)
}

export function userToken(): string {
  return readUserSession()?.token ?? ''
}

export function currentUser(): AppUser | null {
  return readUserSession()?.user ?? null
}

export function isAdminUser(): boolean {
  return currentUser()?.role === 'admin'
}

// ---------------------------------------------------------------------------
// API calls — the exact backend error is always kept (no generic messages)
// ---------------------------------------------------------------------------

function describeFailure(status: number, data: Record<string, unknown>, raw: string): string {
  const message = typeof data.error === 'string' ? data.error.trim() : ''
  if (message) return message
  const snippet = raw.trim().replace(/\s+/g, ' ').slice(0, 240)
  return snippet ? `Backend error (HTTP ${status}): ${snippet}` : `Backend error (HTTP ${status}) with no message.`
}

async function call<T extends object>(endpoint: string, body?: Record<string, unknown>): Promise<T> {
  const token = userToken()
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    })
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : 'network error'
    throw new TelegramLoginError(`Backend is unreachable (${detail}).`)
  }
  const raw = await response.text()
  let data: Record<string, unknown> = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
  } catch {
    // Non-JSON body (proxy/HTML error page): the raw text is shown instead.
  }
  if (!response.ok) throw new TelegramLoginError(describeFailure(response.status, data, raw))
  return data as T
}

/** Public widget configuration. Never contains the bot token. */
export function fetchTelegramLoginConfig(): Promise<TelegramLoginConfig> {
  return call<TelegramLoginConfig>(AUTH_ENDPOINT)
}

export async function loginWithTelegram(auth: TelegramWidgetUser): Promise<UserSession> {
  const data = await call<{ ok: true; user: AppUser; token: string; expiresAt?: string }>(AUTH_ENDPOINT, { action: 'login', auth })
  if (!data.token) throw new TelegramLoginError('Login succeeded but the backend returned no session token.')
  const session: UserSession = { token: data.token, user: data.user, expiresAt: data.expiresAt }
  writeUserSession(session)
  return session
}

/** Re-reads the account from the server so a role change applies immediately. */
export async function refreshUserSession(): Promise<UserSession | null> {
  const token = userToken()
  if (!token) return null
  try {
    const data = await call<{ ok: true; user: AppUser }>(AUTH_ENDPOINT, { action: 'session' })
    const session: UserSession = { token, user: data.user, expiresAt: readUserSession()?.expiresAt }
    writeUserSession(session)
    return session
  } catch {
    // An expired/revoked token must not keep the user looking signed in.
    clearUserSession()
    return null
  }
}

/** Server-side logout (invalidates issued tokens) + local cleanup. */
export async function logoutUser(): Promise<void> {
  try {
    await call<{ ok: true }>(AUTH_ENDPOINT, { action: 'logout' })
  } catch {
    // Even if the call fails the device signs out locally.
  }
  clearUserSession()
}

// ---------------------------------------------------------------------------
// Admin: who is an admin, and account roles
// ---------------------------------------------------------------------------

export async function listAdmins(): Promise<AdminEntry[]> {
  const data = await call<{ admins: AdminEntry[] }>(AUTH_ENDPOINT, { action: 'listAdmins' })
  return data.admins
}

export async function addAdmin(telegramId: string, label = ''): Promise<AdminEntry[]> {
  const data = await call<{ admins: AdminEntry[] }>(AUTH_ENDPOINT, { action: 'addAdmin', telegramId, label })
  return data.admins
}

export async function removeAdmin(telegramId: string): Promise<AdminEntry[]> {
  const data = await call<{ admins: AdminEntry[] }>(AUTH_ENDPOINT, { action: 'removeAdmin', telegramId })
  return data.admins
}

export async function listTelegramUsers(): Promise<AppUser[]> {
  const data = await call<{ users: AppUser[] }>(AUTH_ENDPOINT, { action: 'listUsers' })
  return data.users
}

export async function setTelegramUserRole(telegramId: string, role: UserRole): Promise<AppUser> {
  const data = await call<{ user: AppUser }>(AUTH_ENDPOINT, { action: 'setUserRole', telegramId, role })
  return data.user
}

export async function setTelegramUserStatus(telegramId: string, status: 'on' | 'off'): Promise<AppUser> {
  const data = await call<{ user: AppUser }>(AUTH_ENDPOINT, { action: 'setUserStatus', telegramId, status })
  return data.user
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

export interface UploadLimits {
  chunkSize: number
  maxBytes: number
}

export async function fetchUploads(): Promise<{ uploads: UploadRecord[]; categories: UploadCategory[]; limits?: UploadLimits }> {
  return call<{ uploads: UploadRecord[]; categories: UploadCategory[]; limits?: UploadLimits }>(UPLOAD_ENDPOINT)
}

export async function fetchAdminUploads(): Promise<{ uploads: UploadRecord[]; categories: UploadCategory[] }> {
  return call<{ uploads: UploadRecord[]; categories: UploadCategory[] }>(UPLOAD_ENDPOINT, { action: 'list' })
}

export interface UploadMeta {
  title: string
  category: string
  thumbnail?: string
  accessRole?: UploadRecord['accessRole']
  published?: boolean
}

function toBase64(chunk: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new TelegramLoginError('The file could not be read on this device.'))
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }
    reader.readAsDataURL(chunk)
  })
}

/**
 * Split → post → finalise. Vercel caps a single function body at ~4.5MB, so the
 * file travels as 3MB base64 chunks; the backend reassembles them in PostgreSQL.
 */
export async function uploadFile(file: File, meta: UploadMeta, onProgress?: (fraction: number) => void): Promise<UploadRecord> {
  const started = await call<{ ok: true; id: string; chunks: number; chunkSize: number }>(UPLOAD_ENDPOINT, {
    action: 'start',
    title: meta.title,
    category: meta.category,
    thumbnail: meta.thumbnail,
    accessRole: meta.accessRole,
    published: meta.published,
    contentType: file.type || 'application/octet-stream',
    filename: file.name,
    size: file.size
  })
  for (let index = 0; index < started.chunks; index += 1) {
    const slice = file.slice(index * started.chunkSize, (index + 1) * started.chunkSize)
    await call<{ ok: true }>(UPLOAD_ENDPOINT, { action: 'chunk', id: started.id, index, data: await toBase64(slice) })
    onProgress?.((index + 1) / started.chunks)
  }
  const finished = await call<{ ok: true; upload: UploadRecord }>(UPLOAD_ENDPOINT, {
    action: 'finish',
    id: started.id,
    title: meta.title,
    category: meta.category,
    thumbnail: meta.thumbnail
  })
  return finished.upload
}

export async function updateUpload(id: string, patch: Partial<UploadMeta>): Promise<UploadRecord> {
  const data = await call<{ ok: true; upload: UploadRecord }>(UPLOAD_ENDPOINT, { action: 'update', id, ...patch })
  return data.upload
}

export async function deleteUpload(id: string): Promise<void> {
  await call<{ ok: true; id: string }>(UPLOAD_ENDPOINT, { action: 'delete', id })
}

// ---------------------------------------------------------------------------
// Wiring uploads into the existing player / download code
// ---------------------------------------------------------------------------

/**
 * Absolute URL for an upload.
 *
 * The `file=` suffix keeps a media extension on the URL, which is what
 * playbackCandidates() and the download helper look for — so uploads play and
 * download through the existing code paths with no changes to them.
 */
export function absoluteUploadUrl(upload: UploadRecord): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const extension = upload.kind === 'video' ? 'mp4' : upload.kind === 'image' ? 'jpg' : upload.kind === 'audio' ? 'mp3' : 'bin'
  const name = (upload.filename || `${upload.title || upload.id}.${extension}`).replace(/[^\w.-]+/g, '_')
  const safeName = /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.${extension}`
  return `${origin}${upload.url}?file=${encodeURIComponent(safeName)}`
}

/** Maps an upload onto the app's existing MediaItem shape. */
export function uploadToMediaItem(upload: UploadRecord): MediaItem {
  const url = absoluteUploadUrl(upload)
  const isVideo = upload.kind === 'video'
  const isImage = upload.kind === 'image'
  return {
    id: `xsu-${upload.id}`,
    title: upload.title,
    description: upload.category,
    creator: 'X-Sutra',
    thumbnail: upload.thumbnail || (isImage ? url : ''),
    thumbnailUrls: upload.thumbnail ? [upload.thumbnail] : isImage ? [url] : [],
    videoUrl: isVideo ? url : undefined,
    sourceUrl: url,
    duration: 0,
    likes: 0,
    views: 0,
    width: 0,
    height: 0,
    createdAt: Number.isFinite(Date.parse(upload.createdAt)) ? Date.parse(upload.createdAt) : Date.now(),
    hasAudio: true,
    tags: upload.category ? [upload.category] : [],
    niches: []
  }
}

// ---------------------------------------------------------------------------
// The official Telegram Login Widget
// ---------------------------------------------------------------------------

const WIDGET_SRC = 'https://telegram.org/js/telegram-widget.js?22'
const CALLBACK = 'xSutraTelegramAuth'

/**
 * Renders Telegram's official login button into `container`. The bot's domain
 * must be registered with @BotFather (/setdomain) or Telegram refuses to show
 * the button — the README documents that step.
 */
export function renderTelegramWidget(options: {
  botUsername: string
  container: HTMLElement
  onAuth: (user: TelegramWidgetUser) => void
  size?: 'small' | 'medium' | 'large'
}): () => void {
  const target = window as unknown as Record<string, unknown>
  target[CALLBACK] = (user: TelegramWidgetUser) => options.onAuth(user)

  const script = document.createElement('script')
  script.async = true
  script.src = WIDGET_SRC
  script.setAttribute('data-telegram-login', options.botUsername)
  script.setAttribute('data-size', options.size ?? 'large')
  script.setAttribute('data-radius', '10')
  script.setAttribute('data-userpic', 'false')
  script.setAttribute('data-onauth', `${CALLBACK}(user)`)
  options.container.replaceChildren(script)

  return () => {
    delete target[CALLBACK]
    options.container.replaceChildren()
  }
}
