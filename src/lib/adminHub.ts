import { fetchPremiumCatalog, premiumAdmin } from './premium'
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
  role: 'normal' | 'premium' | 'vip' | 'admin'
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

export function cacheHub(hub: AdminHub): AdminHub {
  writeStored(HUB_KEY, hub)
  return hub
}

export function localHub(): AdminHub {
  return { ...defaultHub(), ...readStored<Partial<AdminHub>>(HUB_KEY, {}) }
}

export async function loadHub(): Promise<AdminHub> {
  const local = localHub()
  try {
    const catalog = await fetchPremiumCatalog()
    if (catalog.adminHub) return cacheHub({ ...defaultHub(), ...catalog.adminHub })
  } catch { /* use local */ }
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
