/**
 * DiscordLoginProvider — app-wide state for the real Discord web login.
 *
 * - Boots: if Discord redirected back with ?code, turns it into a session.
 * - Persists: the session lives in localStorage, so a saved login is restored
 *   on every app start without showing the login screen again.
 * - Stays fresh: an expiring access token is renewed silently in the
 *   background with the refresh token.
 * - Admin shortcut: when the local admin account is signed in but no Discord
 *   session exists yet, the admin is taken to the Discord login automatically
 *   (once — if it is cancelled, no auto-redirect loop for 24 h).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from './AppContext'
import {
  clearSession,
  dismissedRecently,
  handleCallback,
  markDismissed,
  needsRefresh,
  onDiscordSessionChange,
  readSession,
  refreshSession,
  startDiscordLogin,
  type DiscordProfile,
  type DiscordSession
} from '../lib/discordLogin'

interface DiscordLoginValue {
  user: DiscordProfile | null
  /** True once the boot callback/restore has finished. */
  ready: boolean
  /** True while the tab is on its way to Discord. */
  busy: boolean
  error: string
  lastConnectedAt: number | null
  login: () => void
  logout: () => void
  clearError: () => void
}

const DiscordLoginContext = createContext<DiscordLoginValue | null>(null)

export function DiscordLoginProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { account, notify } = useApp()
  const navigate = useNavigate()
  const [session, setSession] = useState<DiscordSession | null>(readSession)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const booted = useRef(false)
  const autoStarted = useRef(false)

  // Boot: consume Discord's redirect, then silently renew a stale token.
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void (async () => {
      const result = await handleCallback()
      if (result.status === 'ok') {
        setSession(result.session)
        notify(`Discord se login ho gaya — @${result.session.profile.username}`, 'success')
        const target = result.next || '/premium'
        const current = window.location.hash.replace(/^#/, '')
        if (target !== current) navigate(target, { replace: true })
      } else if (result.status === 'error') {
        setError(result.error)
      }
      setSession((current) => {
        if (current && needsRefresh(current)) {
          void refreshSession(current)
            .then((next) => {
              if (next) setSession(next)
            })
            .catch(() => undefined)
        }
        return current
      })
      setReady(true)
    })()
  }, [navigate])

  // Follow session writes from other tabs / the storage event.
  useEffect(() => onDiscordSessionChange(() => setSession(readSession())), [])

  // Admin auto-connect: signed in as admin with no Discord session yet.
  useEffect(() => {
    if (!ready || busy || autoStarted.current) return
    if (account?.role !== 'admin' || session) return
    if (dismissedRecently()) return
    autoStarted.current = true
    setBusy(true)
    startDiscordLogin('/premium')
  }, [ready, busy, account?.role, session])

  const login = useCallback(() => {
    setError('')
    setBusy(true)
    startDiscordLogin('/premium')
  }, [])

  const logout = useCallback(() => {
    clearSession()
    setSession(null)
    // Intentional logout: do not bounce straight back into the auto-login.
    markDismissed()
  }, [])

  const clearError = useCallback(() => setError(''), [])

  const value = useMemo<DiscordLoginValue>(() => ({
    user: session?.profile ?? null,
    ready,
    busy,
    error,
    lastConnectedAt: session?.connectedAt ?? null,
    login,
    logout,
    clearError
  }), [session, ready, busy, error, login, logout, clearError])

  return <DiscordLoginContext.Provider value={value}>{children}</DiscordLoginContext.Provider>
}

export function useDiscordLogin(): DiscordLoginValue {
  const ctx = useContext(DiscordLoginContext)
  if (!ctx) throw new Error('useDiscordLogin must be used inside DiscordLoginProvider')
  return ctx
}
