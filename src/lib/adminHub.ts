import { fetchWithRetry } from './http'
import { writePayQr } from './payQr'
import { premiumAdmin } from './premium'
import { readStored, writeStored } from './storage'

const HUB_KEY = 'x-sutra.admin.hub.v1'
const READ_KEY = 'x-sutra.notify.read.v1'

export interface PlanInfo {
  name: string
  price: string
  description: string
  enabled: boolean
}

export interface HomeCardConfig {
  label: string
  online: string
  title: string
  description: string
  buttonText: string
  buttonUrl: string
  secondaryText: string
  secondaryUrl: string
  image: string
  overlay: boolean
  enabled: boolean
}

export interface HubNotification {
  id: string
  title: string
  message: string
  link: string
  buttonText: string
  active: boolean
  createdAt: string
}

export interface HubUser {
  username: string
  role: import('../types').UserRole
  status: 'on' | 'off'
  createdAt: string
}

export interface AdminHub {
  qr: string
  plans: { premium: PlanInfo; vip: PlanInfo }
  homeCard: HomeCardConfig
  notifications: HubNotification[]
  users: HubUser[]
  hiddenVideos: string[]
}

export function defaultHub(): AdminHub {
  return {
    qr: '',
    plans: {
      premium: { name: 'Premium ⭐', price: '', description: 'Premium Plan', enabled: true },
      vip: { name: 'VIP 💎', price: '', description: 'VIP Plan', enabled: true }
    },
    homeCard: {
      label: 'REAL PUBLIC FEED',
      online: '',
      title: "What's moving now.",
      description: 'Swipe down for another real source batch. Scroll continuously for more public videos.',
      buttonText: '',
      buttonUrl: '',
      secondaryText: '',
      secondaryUrl: '',
      image: '',
      overlay: true,
      enabled: true
    },
    notifications: [],
    users: [{ username: 'admin', role: 'admin', status: 'on', createdAt: new Date().toISOString() }],
    hiddenVideos: []
  }
}

// Guarantees a fully-formed AdminHub even when the API (or cached data) returns a
// partial / mis-shaped payload. Without this, `hub.users.length` etc. can throw and
// blank the whole Admin panel through the ErrorBoundary.
export function normalizeHub(input: Partial<AdminHub> | null | undefined): AdminHub {
  const base = defaultHub()
  const data = (input && typeof input === 'object') ? input : {}
  return {
    qr: typeof data.qr === 'string' ? data.qr : base.qr,
    plans: {
      premium: { ...base.plans.premium, ...(data.plans?.premium ?? {}) },
      vip: { ...base.plans.vip, ...(data.plans?.vip ?? {}) }
    },
    homeCard: { ...base.homeCard, ...(data.homeCard ?? {}) },
    notifications: Array.isArray(data.notifications) ? data.notifications : base.notifications,
    users: Array.isArray(data.users) && data.users.length > 0 ? data.users : base.users,
    hiddenVideos: Array.isArray(data.hiddenVideos) ? data.hiddenVideos : base.hiddenVideos
  }
}

export function cacheHub(hub: AdminHub): AdminHub {
  writeStored(HUB_KEY, normalizeHub(hub))
  return normalizeHub(hub)
}

export function localHub(): AdminHub {
  return normalizeHub(readStored<Partial<AdminHub>>(HUB_KEY, {}))
}

export async function loadHub(): Promise<AdminHub> {
  const local = localHub()
  try {
    const response = await fetchWithRetry('/api/premium', { headers: { Accept: 'application/json' } })
    if (response.ok) {
      const data = await response.json() as Partial<AdminHub>
      if (data && Object.keys(data).length > 0) {
        return cacheHub(normalizeHub(data))
      }
    }
  } catch {
    /* use local data on any network error */
  }
  return local
}

export async function saveHub(hub: AdminHub): Promise<AdminHub> {
  cacheHub(hub)
  await premiumAdmin('updateAdminHub', { hub })
  return hub
}

export function unreadCount(hub: AdminHub): number {
  const read = readStored<string[]>(READ_KEY, [])
  return hub.notifications.filter((item) => item.active && !read.includes(item.id)).length
}

export function markNotificationsRead(hub: AdminHub): void {
  writeStored(READ_KEY, hub.notifications.map((item) => item.id))
}

export function relativeTime(iso: string): string {
  const delta = Date.now() - Date.parse(iso)
  if (!Number.isFinite(delta) || delta < 60_000) return 'just now'
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)} minutes ago`
  if (delta < 86400_000) return `${Math.floor(delta / 3600_000)} hours ago`
  if (delta < 172800_000) return 'Yesterday'
  return `${Math.floor(delta / 86400_000)} days ago`
}

export function openHubLink(url: string, navigate: (path: string) => void): void {
  const value = url.trim()
  if (!value) return
  if (value.startsWith('#/')) {
    navigate(value.slice(1))
    return
  }
  if (value.startsWith('/')) {
    navigate(value)
    return
  }
  window.open(value, '_blank', 'noopener,noreferrer')
}

/* ------------------------------------------------------------------ *
 * Reactive hub store.
 *
 * Admin edits (payment QR, Premium/VIP plans, home banner, notifications)
 * go through `commitHub`, which immediately updates this module-level value,
 * re-caches it to localStorage and notifies every mounted subscriber. Screens
 * that display the QR / plans / banner / bell then re-render with the change
 * on the spot ("login page ka plan popup turant update" etc.), while the same
 * device stays consistent with the server through `saveHub`.
 * ------------------------------------------------------------------ */

type HubListener = (hub: AdminHub) => void

let current: AdminHub | null = null
const listeners = new Set<HubListener>()

export function getHubSnapshot(): AdminHub {
  return current ?? normalizeHub(readStored<Partial<AdminHub>>(HUB_KEY, {}))
}

function publish(next: AdminHub): AdminHub {
  current = normalizeHub(next)
  for (const listener of listeners) {
    try { listener(current) } catch { /* a dead subscriber must not break the rest */ }
  }
  return current
}

export function subscribeHub(listener: HubListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Persist an admin change everywhere and broadcast it. Local storage + the
 * in-memory store are updated synchronously so the UI flips instantly; the
 * server sync happens in the background and re-broadcasts the (normalized)
 * result if it differs.
 */
export async function commitHub(next: AdminHub): Promise<AdminHub> {
  const normalized = publish(cacheHub(normalizeHub(next)))
  writePayQr(normalized.qr)
  void saveHub(normalized)
    .then((saved) => publish(normalizeHub(saved)))
    .catch(() => { /* keep the already-broadcast local value on any error */ })
  return normalized
}

/** Pull the latest hub from the server/local cache and broadcast it. */
export async function refreshHub(): Promise<AdminHub> {
  const hub = await loadHub()
  return publish(hub)
}
