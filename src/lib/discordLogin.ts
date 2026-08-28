/**
 * Real Discord web login (OAuth2) for X-Sutra Premium.
 *
 * The flow:
 *   1. startDiscordLogin() generates a random `state`, remembers it, and
 *      navigates the tab to /api/discord/login → 302 → discord.com.
 *   2. The user signs in on Discord and lands back on this app's origin with
 *      ?code=...&state=... in the URL (the app is hash-routed, so the route
 *      is untouched).
 *   3. handleCallback() verifies the state, POSTs the code to
 *      /api/discord/callback and stores the session in localStorage.
 *
 * Persistence: the session (profile + access token + refresh token) survives
 * app restarts. When the one-hour access token is about to expire,
 * refreshSession() silently renews it with the refresh token — the user logs
 * in once and never sees the login screen again, until they log out or
 * Discord revokes the token.
 */

export interface DiscordProfile {
  id: string
  username: string
  globalName: string
  displayName: string
  avatar: string | null
  avatarUrl: string | null
}

export interface DiscordSession {
  profile: DiscordProfile
  accessToken: string
  refreshToken: string | null
  /** Absolute ms when the access token expires. */
  expiresAt: number
  /** Absolute ms of the original login. */
  connectedAt: number
}

const SESSION_KEY = 'xs.discord.session.v1'
const PENDING_KEY = 'xs.discord.pending.v1'
const DISMISS_KEY = 'xs.discord.dismissed.v1'
const CHANGE_EVENT = 'xs-discord-changed'

/** After a cancelled/failed login, do not auto-redirect again for this long. */
const DISMISS_WINDOW_MS = 24 * 60 * 60 * 1000
/** Renew the access token at least this long before it expires. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full/blocked — login still works for this tab */
  }
}

function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

function emitChange(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function onDiscordSessionChange(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

// ─── Session storage ───

export function readSession(): DiscordSession | null {
  const session = readJson<DiscordSession | null>(SESSION_KEY, null)
  if (!session?.profile?.id || !session.accessToken) return null
  return session
}

export function saveSession(session: DiscordSession): void {
  writeJson(SESSION_KEY, session)
  emitChange()
}

export function clearSession(): void {
  removeKey(SESSION_KEY)
  emitChange()
}

// ─── Pending login (state + destination) ───

interface PendingLogin {
  state: string
  next: string
}

function readPending(): PendingLogin | null {
  const pending = readJson<PendingLogin | null>(PENDING_KEY, null)
  return pending?.state ? pending : null
}

function writePending(state: string, next: string): void {
  writeJson(PENDING_KEY, { state, next })
}

function clearPending(): void {
  removeKey(PENDING_KEY)
}

// ─── Dismiss guard (prevents an auto-login redirect loop) ───

export function markDismissed(): void {
  writeJson(DISMISS_KEY, Date.now())
}

export function dismissedRecently(now = Date.now()): boolean {
  const at = readJson<number>(DISMISS_KEY, 0)
  return now - at < DISMISS_WINDOW_MS
}

// ─── Step 1: start the OAuth redirect ───

export function startDiscordLogin(next = '/premium'): void {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  writePending(state, next)
  const params = new URLSearchParams({ origin: window.location.origin, state, next })
  window.location.assign(`/api/discord/login?${params.toString()}`)
}

// ─── Step 2: handle Discord's redirect back ───

export type DiscordCallbackResult =
  | { status: 'none' }
  | { status: 'ok'; session: DiscordSession; next: string }
  | { status: 'cancelled' }
  | { status: 'error'; error: string }

/**
 * Call once when the app boots. No-op unless the URL carries Discord's
 * ?code / ?error query. Always cleans the query out of the address bar.
 */
export async function handleCallback(): Promise<DiscordCallbackResult> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const error = params.get('error')
  if (!code && !error) return { status: 'none' }

  const cleanUrl = (): void => {
    try {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
    } catch {
      /* ignore */
    }
  }

  if (error) {
    cleanUrl()
    clearPending()
    markDismissed()
    return { status: 'cancelled' }
  }

  const pending = readPending()
  if (!code || !pending || !state || state !== pending.state) {
    cleanUrl()
    clearPending()
    markDismissed()
    return { status: 'error', error: 'Login verification failed (state mismatch). Try again.' }
  }

  try {
    const response = await fetch('/api/discord/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, origin: window.location.origin })
    })
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean
      error?: string
      profile?: DiscordProfile
      accessToken?: string
      refreshToken?: string | null
      expiresAt?: number
    }
    clearPending()
    if (!response.ok || !data.ok || !data.profile || !data.accessToken || !data.expiresAt) {
      cleanUrl()
      markDismissed()
      return { status: 'error', error: data.error || `Discord login failed (${response.status}).` }
    }
    const session: DiscordSession = {
      profile: data.profile,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? null,
      expiresAt: data.expiresAt,
      connectedAt: Date.now()
    }
    saveSession(session)
    cleanUrl()
    return { status: 'ok', session, next: pending.next }
  } catch {
    cleanUrl()
    clearPending()
    markDismissed()
    return { status: 'error', error: 'Could not reach the server. Check your connection and try again.' }
  }
}

// ─── Step 3: keep the login alive without ever asking again ───

export function needsRefresh(session: DiscordSession, now = Date.now()): boolean {
  return session.expiresAt - now < REFRESH_MARGIN_MS
}

/**
 * Silently renew the access token. Returns the updated session, or null when
 * Discord rejects the refresh token (then the caller clears the session and
 * the user logs in one more time).
 */
export async function refreshSession(session: DiscordSession): Promise<DiscordSession | null> {
  if (!session.refreshToken) return null
  try {
    const response = await fetch('/api/discord/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken, origin: window.location.origin })
    })
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean
      profile?: DiscordProfile
      accessToken?: string
      refreshToken?: string | null
      expiresAt?: number
    }
    if (!response.ok || !data.ok || !data.accessToken || !data.expiresAt) return null
    const next: DiscordSession = {
      ...session,
      profile: data.profile ?? session.profile,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? session.refreshToken,
      expiresAt: data.expiresAt
    }
    saveSession(next)
    return next
  } catch {
    return null
  }
}
