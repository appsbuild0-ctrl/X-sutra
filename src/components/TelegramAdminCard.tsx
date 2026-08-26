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

type Stage = 'loading' | 'ready' | 'otp' | '2fa' | 'authorized'

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
 * Simple Telegram owner login: tap "Send login code", enter the OTP (and 2FA
 * once if enabled), done. No setup secret or key is ever asked. After the
 * first success the login is saved on the device and this tab opens already
 * connected.
 */
export function TelegramAdminCard({ onChanged }: { onChanged?: () => void }): React.JSX.Element {
  const { notify } = useApp()
  const changed = () => { onChanged?.() }
  const [stage, setStage] = useState<Stage>('loading')
  const [status, setStatus] = useState<TelegramAuthStatus | null>(null)
  const [phone, setPhone] = useState('')
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
      setError(caught instanceof TelegramAdminError ? caught.message : 'Telegram operation failed.')
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

  const sendCode = () => void run(async () => {
    const result = await sendTelegramOtp(phone.trim())
    setSavedLogin(ownerSessionActive())
    if (result.status === 'already_authorized') {
      setStage('authorized')
      notify('Already connected — no new code needed', 'success')
      changed()
      await refreshQuiet()
      return
    }
    setStage('otp')
    notify(result.delivery === 'telegram_app' ? 'Code sent to your Telegram app' : 'Code sent to your phone', 'success')
  })

  const confirmOtp = () => void run(async () => {
    const result = await verifyTelegramOtp(code)
    if (result.status === '2fa_required') {
      setStage('2fa')
      return
    }
    setStage('authorized')
    setSavedLogin(ownerSessionActive())
    setCode('')
    notify('Connected — login saved on this device', 'success')
    changed()
    await refreshQuiet()
  })

  const confirmTwoFactor = () => void run(async () => {
    await verifyTelegramTwoFactor(password)
    setStage('authorized')
    setSavedLogin(ownerSessionActive())
    setPassword('')
    setCode('')
    notify('Connected — login saved on this device', 'success')
    await refreshQuiet()
  })

  const refreshQuiet = async () => {
    try {
      setStatus(await fetchTelegramStatus(true))
    } catch { /* keep the last known status */ }
  }

  /** Imports the owner's Telegram channels so the Premium list is populated. */
  const syncNow = () => void run(async () => {
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
            One-time login. The code goes to the owner phone set on the server; enter it below and you're connected.
            After this, the tab opens already connected.
          </p>

          {stage === 'ready' && (
            <>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Owner phone, e.g. +91… (as set on the server)"
                inputMode="tel"
                autoComplete="tel"
              />
              <button className="primary-button" type="button" disabled={busy} onClick={sendCode}>
                {busy ? 'Sending…' : 'Send login code'}
              </button>
            </>
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

          {error && <p className="login-error" role="alert">{error}</p>}
        </div>
      )}

      {stage === 'authorized' && (
        <div className="settings-card">
          <div className="setting-row"><span><strong>Source channels</strong></span>
            <StatusBadge ok={(synced?.channels ?? 0) > 0}>{synced ? `${synced.channels} imported` : 'Not imported yet'}</StatusBadge>
          </div>
          <p className="form-help">
            ✅ Telegram is connected and the login is saved on this device — you won't be asked again. Import your
            channels once and they appear in Premium under <strong>🔐 Telegram sources</strong> (served by{' '}
            <code>/api/telegram/channels</code>).
          </p>
          <div className="home-header-actions">
            <button className="primary-button" type="button" disabled={busy} onClick={syncNow}>
              {busy ? 'Importing channels…' : 'Import Telegram channels'}
            </button>
          </div>
          {synced && (
            <p className="form-help" style={{ margin: 0 }}>
              Last import: scanned {synced.scanned} chats → {synced.channels} channels/supergroups → {synced.saved} saved.
            </p>
          )}
        </div>
      )}
    </>
  )
}
