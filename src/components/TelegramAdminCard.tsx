import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  endOwnerSession,
  fetchTelegramStatus,
  ownerSessionActive,
  sendTelegramOtp,
  syncTelegramChannels,
  TelegramAdminError,
  verifyTelegramOtp,
  verifyTelegramTwoFactor,
  type TelegramAuthStatus,
  type TelegramSyncResult
} from '../lib/telegramAdmin'

/**
 * `ready`   → one button: send the login code to the server's owner phone
 * `otp`     → the owner types the code (the only field in the whole flow)
 * `2fa`     → Telegram 2FA password, only if the account has 2FA on
 * `finishing` → OTP accepted: saving the owner token and importing channels
 * `authorized` → connected, channels imported, panel can close itself
 */
type Stage = 'loading' | 'ready' | 'otp' | '2fa' | 'finishing' | 'authorized'

function StatusBadge({ ok, children }: { ok: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <span
      className="online-pill"
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: ok ? '#7ef0c2' : '#ffb4a2',
        background: ok ? 'rgba(46, 204, 113, .14)' : 'rgba(255, 99, 71, .14)'
      }}
    >
      {children}
    </span>
  )
}

/**
 * Telegram owner login, kept as short as possible: the phone number comes from
 * the server environment (TELEGRAM_PHONE), so the owner only ever types the OTP.
 *
 * On success the card, in one go:
 *   1. receives the signed owner token (saved on the device by lib/telegramAdmin),
 *   2. imports the owner's channels so Premium is populated straight away,
 *   3. calls `onConnected` so the hosting panel closes itself.
 *
 * Failures show the exact backend/Telegram error (for example
 * `PHONE_CODE_INVALID`), never a generic "authorization failed".
 */
export function TelegramAdminCard({ onChanged, onConnected }: { onChanged?: () => void; onConnected?: () => void }): React.JSX.Element {
  const { notify } = useApp()
  const changed = () => { onChanged?.() }
  const [stage, setStage] = useState<Stage>('loading')
  const [status, setStatus] = useState<TelegramAuthStatus | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedLogin, setSavedLogin] = useState<boolean>(() => ownerSessionActive())
  const [synced, setSynced] = useState<TelegramSyncResult | null>(null)
  const booted = useRef(false)

  const run = async (job: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await job()
    } catch (caught) {
      // TelegramAdminError carries the backend's own wording verbatim.
      setError(caught instanceof TelegramAdminError ? caught.message : caught instanceof Error ? caught.message : 'Telegram operation failed.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void run(async () => {
      const result = await fetchTelegramStatus()
      setStatus(result)
      setStage(result.connection.connected ? 'authorized' : 'ready')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = () => void run(async () => {
    const result = await fetchTelegramStatus(true)
    setStatus(result)
    setSavedLogin(ownerSessionActive())
    setStage(result.connection.connected ? 'authorized' : 'ready')
    setCode('')
    setPassword('')
  })

  const refreshQuiet = async () => {
    try {
      setStatus(await fetchTelegramStatus(true))
    } catch { /* keep the last known status */ }
  }

  /** Sends the code to the owner phone configured on the server — nothing to type. */
  const sendCode = () => void run(async () => {
    const result = await sendTelegramOtp()
    setSavedLogin(ownerSessionActive())
    if (result.status === 'already_authorized') {
      setStage('authorized')
      notify('Already connected — no new code needed', 'success')
      changed()
      await refreshQuiet()
      return
    }
    setStage('otp')
    notify(result.delivery === 'telegram_app' ? 'Code sent to your Telegram app' : 'Code sent to the owner phone', 'success')
  })

  /**
   * Post-OTP finish line: the owner token is already stored by the API client,
   * so the only work left is the channel import, then handing control back to
   * the panel so it can close.
   */
  const finishLogin = async () => {
    setStage('finishing')
    setSavedLogin(ownerSessionActive())
    setCode('')
    setPassword('')
    try {
      const result = await syncTelegramChannels()
      setSynced(result)
      notify(
        result.channels > 0
          ? `Connected — imported ${result.channels} Telegram channel${result.channels === 1 ? '' : 's'}`
          : `Connected — scanned ${result.scanned} chats, no channel found on this account yet`,
        'success'
      )
    } catch (caught) {
      // The Telegram login itself worked; only the import failed. Keep the
      // exact error on screen and let the owner retry without logging in again.
      setError(caught instanceof TelegramAdminError ? caught.message : caught instanceof Error ? caught.message : 'Channel import failed.')
      notify('Telegram connected, but the channel import failed', 'error')
    }
    setStage('authorized')
    changed()
    await refreshQuiet()
    // Give the success state a beat to be seen, then close the panel.
    window.setTimeout(() => { onConnected?.() }, 1000)
  }

  const confirmOtp = () => void run(async () => {
    const result = await verifyTelegramOtp(code)
    if (result.status === '2fa_required') {
      setStage('2fa')
      notify('This account uses 2FA — enter the Telegram password to finish', 'success')
      return
    }
    await finishLogin()
  })

  const confirmTwoFactor = () => void run(async () => {
    await verifyTelegramTwoFactor(password)
    await finishLogin()
  })

  /** Imports the owner's Telegram channels so the Premium list is populated. */
  const syncNow = () => void run(async () => {
    // A server-side Telegram session can predate this browser's owner token
    // (for example after clearing site data). Reuse the authorized Telegram
    // session to issue a fresh owner token before calling the owner-only sync.
    // send_otp returns already_authorized here, so no new code is sent.
    if (!ownerSessionActive()) {
      const restored = await sendTelegramOtp()
      if (restored.status !== 'already_authorized') {
        throw new TelegramAdminError('Telegram login needs to be completed before importing channels.')
      }
      setSavedLogin(true)
    }
    const result = await syncTelegramChannels()
    setSynced(result)
    if (result.channels > 0) {
      notify(`Imported ${result.channels} Telegram channel${result.channels === 1 ? '' : 's'} — opening Premium now`, 'success')
    } else {
      notify(`Scanned ${result.scanned} chats but found no channel or supergroup on this Telegram account`)
    }
    changed()
  })

  const forget = () => {
    endOwnerSession()
    setStage('ready')
    setStatus((current) => (current ? { ...current, connection: { ...current.connection, connected: false, status: 'ready' } } : current))
    setCode('')
    setPassword('')
    setError('')
    setSavedLogin(false)
    notify('This device will ask for a login code next time')
  }

  if (stage === 'loading') {
    return (
      <div className="settings-card">
        <p className="form-help" style={{ margin: 0 }}>{busy ? 'Checking your Telegram source…' : 'Connecting to the private source…'}</p>
        {error && <p className="login-error" role="alert">{error}</p>}
      </div>
    )
  }

  const phoneHint = status?.configuration.phoneHint || status?.connection.telegramUserId || ''

  return (
    <>
      <div className="settings-card">
        <div className="setting-row"><span><strong>Source connection</strong></span>
          {status ? <StatusBadge ok={status.connection.connected}>{
            status.connection.connected ? 'Connected' : status.connection.status.replace(/_/g, ' ')
          }</StatusBadge> : <small>Checking…</small>}
        </div>
        <div className="setting-row"><span><strong>Saved login</strong></span>
          <StatusBadge ok={savedLogin}>{savedLogin ? 'This device — no login needed again' : 'Not saved yet'}</StatusBadge>
        </div>
        {status && !status.configuration.configured && (
          <p className="form-help" role="alert">Server is missing variables: {status.configuration.missing.join(', ')} — add them in Vercel and refresh.</p>
        )}
        <div className="home-header-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={refresh}>Refresh</button>
          {savedLogin && <button className="text-button" type="button" onClick={forget}>Forget this device</button>}
        </div>
      </div>

      {stage !== 'authorized' && (
        <div className="premium-post-form settings-card" style={{ padding: 14 }}>
          <strong>Connect Telegram {status && !status.configuration.configured ? '' : '🔐'}</strong>
          <p className="form-help">
            One-time login{phoneHint && <> for {phoneHint}</>}. The number is read from the server, so there is nothing to
            type — tap below, then enter the code Telegram sends you. Channels are imported automatically.
          </p>

          {stage === 'ready' && (
            <button className="primary-button" type="button" disabled={busy} onClick={sendCode}>
              {busy ? 'Sending…' : 'Send login code'}
            </button>
          )}

          {stage === 'otp' && (
            <>
              <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Login code" inputMode="numeric" autoComplete="one-time-code" />
              <button className="primary-button" type="button" disabled={busy || code.trim().length === 0} onClick={confirmOtp}>
                {busy ? 'Verifying…' : 'Connect'}
              </button>
              <button className="secondary-button" type="button" disabled={busy} onClick={sendCode}>Resend code</button>
            </>
          )}

          {stage === '2fa' && (
            <>
              <p className="form-help">This account has Telegram 2FA on. Enter the cloud password once to finish.</p>
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Telegram 2FA password" type="password" autoComplete="current-password" />
              <button className="primary-button" type="button" disabled={busy || password.length === 0} onClick={confirmTwoFactor}>
                {busy ? 'Verifying…' : 'Connect'}
              </button>
            </>
          )}

          {stage === 'finishing' && (
            <p className="form-help" style={{ margin: 0 }}>✅ Login accepted — saving the owner login on this device and importing your channels…</p>
          )}

          {error && <p className="login-error" role="alert">{error}</p>}
        </div>
      )}

      {stage === 'authorized' && (
        <div className="settings-card">
          <div className="setting-row"><span><strong>Source channels</strong></span>
            <StatusBadge ok={(synced?.channels ?? 0) > 0}>{synced ? `${synced.channels} imported` : 'Not imported yet'}</StatusBadge>
          </div>
          <p className="form-help">
            ✅ Telegram is connected and the login is saved on this device — you won't be asked again. Channels appear in
            Premium under <strong>🔐 Telegram sources</strong> (served by <code>/api/telegram/channels</code>).
          </p>
          <div className="home-header-actions">
            <button className="primary-button" type="button" disabled={busy} onClick={syncNow}>
              {busy ? 'Importing channels…' : (synced ? 'Import channels again' : 'Import Telegram channels')}
            </button>
          </div>
          {synced && (
            <p className="form-help" style={{ margin: 0 }}>
              Last import: scanned {synced.scanned} chats → {synced.channels} channels/supergroups → {synced.saved} saved.
            </p>
          )}
          {error && <p className="login-error" role="alert">{error}</p>}
        </div>
      )}
    </>
  )
}
