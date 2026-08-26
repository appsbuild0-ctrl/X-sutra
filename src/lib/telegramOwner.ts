// Device-local owner session for the private Telegram console.
//
// Only the signed owner session token is stored here — the one-time credential
// issued by the backend right after the Telegram login. The ADMIN_SETUP_SECRET
// is never written to storage by any module (see scripts/verify-telegram-security.mjs).
const KEY = 'x-sutra.telegram.owner.session.v1'

export interface OwnerSession {
  token: string
  expiresAt?: string
}

export function readOwnerSession(): OwnerSession | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as OwnerSession
    if (!parsed?.token || typeof parsed.token !== 'string') return null
    if (parsed.expiresAt && Number.isFinite(Date.parse(parsed.expiresAt)) && Date.parse(parsed.expiresAt) <= Date.now()) {
      clearOwnerSession()
      return null
    }
    return { token: parsed.token, expiresAt: parsed.expiresAt }
  } catch {
    return null
  }
}

export function writeOwnerSession(token: string, expiresAt?: string): void {
  if (!token) return
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ token, expiresAt }))
  } catch {
    // Storage can be unavailable (private mode). The console still works for
    // this tab; it simply asks once more on the next visit.
  }
}

export function clearOwnerSession(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing to remove.
  }
}
