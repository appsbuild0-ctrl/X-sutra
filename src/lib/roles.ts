import type { UserRole } from '../types'

export const ROLE_META: Record<UserRole, { label: string; emoji: string }> = {
  normal: { label: 'Normal', emoji: '👤' },
  creator: { label: 'Creator', emoji: '🪪' },
  premium: { label: 'Premium', emoji: '⭐' },
  vip: { label: 'VIP', emoji: '💎' },
  admin: { label: 'Admin', emoji: '👑' }
}

export function roleLabel(role?: UserRole | string | null): string {
  const key = (role === 'user' ? 'creator' : role) as UserRole
  const meta = ROLE_META[key] ?? ROLE_META.normal
  return `${meta.emoji} ${meta.label}`
}

export function hasPremiumAccess(role?: UserRole | string | null): boolean {
  return role === 'premium' || role === 'vip' || role === 'admin'
}

export function hasVipAccess(role?: UserRole | string | null): boolean {
  return role === 'vip' || role === 'admin'
}

export function isAdminRole(role?: UserRole | string | null): boolean {
  return role === 'admin'
}
