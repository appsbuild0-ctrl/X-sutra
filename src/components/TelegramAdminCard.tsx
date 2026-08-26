import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  endOwnerSession,
  fetchTelegramStatus,
  ownerSessionActive,
  sendTelegramOtp,
  TelegramAdminError,
  verifyTelegramOtp,
  verifyTelegramTwoFactor,
  type TelegramAuthStatus
} from '../lib/telegramAdmin'

type Stage = 'locked' | 'restoring' | 'ready' | 'otp' | '2fa' | 'authorized'

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

export function TelegramAdminCard(): React.JSX.Element {
  const { notify } = useApp()
  const [secret, setSecret] = useState('')
  const [unlocked, setUnlocked] = useState('')
  const [stage, setStage] = useState<Stage>(() => (ownerSessionActive() ? 'restoring' : 'locked'))
  const [status, setStatus] = useState<TelegramAuthStatus | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedLogin, setSavedLogin] = useState<boolean>(() => ownerSessionActive())
  const restored = useRef(false)

  const run = async (job: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await job()
    } catch (caught) {
      const message = caught instanceof TelegramAdminError ? caught.message : 'Telegram operation failed.'
      setError(message)
      // Expired or rejected owner session → fall back to the one-time unlock.
      if (!ownerSessionActive() && stage !== 'locked') {
        setStage('locked')
        setStatus(null)
        setSavedLogin(false)
      }
    } finally {
      setBusy(false)
    }
  }

  // A device that already logged in reopens the console by itself: no secret,
  // no OTP, no second login.
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    if (!ownerSessionActive()) return
    void run(async () => {
      const result = await fetchTelegramStatus()
      setStatus(result)
      setSavedLogin(true)
      setStage(result.connection.connected ? 'authorized' : 'ready')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const unlock = () => void run(async () => {
    const result = await fetchTelegramStatus(secret)
    setUnlocked(secret)
    setStatus(result)
    setSavedLogin(ownerSessionActive())
    setStage(result.connection.connected ? 'authorized' : 'ready')
    setSecret('')
    if (result.connection.connected) notify('Private Telegram source already connected', 'success')
  })

  const refresh = () => void run(async () => {
    const result = await fetchTelegramStatus(unlocked, true)
    setStatus(result)
    setSavedLogin(ownerSessionActive())
    setStage(result.connection.connected ? 'authorized' : 'ready')
    setCode('')
    setPassword('')
  })

  const sendCode = () => void run(async () => {
    const result = await sendTelegramOtp(unlocked, '')
    setSavedLogin(ownerSessionActive())
    if (result.status === 'already_authorized') {
      setStage('authorized')
      notify('Already logged in — no new code needed', 'success')
      await refreshQuiet()
      return
    }
    setStage('otp')
    notify(result.delivery === 'telegram_app' ? 'Code sent to your Telegram app' : 'Code sent to your phone', 'success')
  })

  const confirmOtp = () => void run(async () => {
    const result = await verifyTelegramOtp(unlocked, code)
    if (result.status === '2fa_required') {
      setStage('2fa')
      return
    }
    setStage('authorized')
    setSavedLogin(ownerSessionActive())
    setCode('')
    setPassword('')
    notify('Telegram login saved on this device', 'success')
    await refreshQuiet()
  })

  const confirmTwoFactor = () => void run(async () => {
    await verifyTelegramTwoFactor(unlocked, password)
    setStage('authorized')
    setSavedLogin(ownerSessionActive())
    setPassword('')
    setCode('')
    notify('Telegram login saved on this device', 'success')
    await refreshQuiet()
  })

  const refreshQuiet = async () => {
    try {
      setStatus(await fetchTelegramStatus(unlocked, true))
    } catch { /* keep the last known status */ }
  }

  const lock = () => {
    endOwnerSession()
    setUnlocked('')
    setSecret('')
    setStage('locked')
    setStatus(null)
    setCode('')
    setPassword('')
    setError('')
    setSavedLogin(false)
    notify('Console locked on this device')
  }

  if (stage === 'locked') {
    return (
      <div className="premium-post-form settings-card" style={{ padding: 14 }}>
        <strong>Private Telegram Source 🔒</strong>
        <p className="form-help">
          One-time owner login. Enter the <code>ADMIN_SETUP_SECRET</code> once — after the Telegram code is verified the
          login is saved on this device and the console opens by itself from then on. The secret itself is never saved.
        </p>
        <input
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder="Admin setup secret"
          type="password"
          autoComplete="off"
        />
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="primary-button" type="button" disabled={busy || secret.trim().length === 0} onClick={unlock}>
          {busy ? 'Checking…' : 'Unlock Telegram Console'}
        </button>
      </div>
    )
  }

  if (stage === 'restoring') {
    return (
      <div className="settings-card">
        <p className="form-help" style={{ margin: 0 }}>{busy ? 'Restoring your saved Telegram login…' : 'Connecting to the private source…'}</p>
        {error && <p className="login-error" role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <>
      <div className="settings-card">
        <div className="setting-row"><span><strong>Backend configuration</strong></span>
          {status ? <StatusBadge ok={status.configuration.configured}>{
            status.configuration.configured ? 'Configured' : 'Incomplete'
          }</StatusBadge> : <small>Checking…</small>}
        </div>
        {status && !status.configuration.configured && (
          <p className="form-help" role="alert">Missing server variables: {status.configuration.missing.join(', ')}</p>
        )}
        <div className="setting-row"><span><strong>Source connection</strong></span>
          {status ? <StatusBadge ok={status.connection.connected}>{
            status.connection.connected ? 'Connected' : status.connection.status.replace(/_/g, ' ')
          }</StatusBadge> : <small>Checking…</small>}
        </div>
        <div className="setting-row"><span><strong>Saved login</strong></span>
          <StatusBadge ok={savedLogin}>{savedLogin ? 'This device — no login needed again' : 'Not saved yet'}</StatusBadge>
        </div>
        <div className="home-header-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={refresh}>Refresh</button>
          <button className="text-button" type="button" onClick={lock}>Forget this device</button>
        </div>
      </div>

      {stage !== 'authorized' && status?.configuration.configured && (
        <div className="premium-post-form settings-card" style={{ padding: 14 }}>
          <strong>Connect the owner account</strong>
          <p className="form-help">
            Telegram sends the login code to the owner phone configured on the server (<code>TELEGRAM_PHONE</code>).
            This is needed once; the encrypted session is then reused automatically.
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
                {busy ? 'Verifying…' : 'Verify code'}
              </button>
              <button className="secondary-button" type="button" disabled={busy} onClick={sendCode}>Resend code</button>
            </>
          )}

          {stage === '2fa' && (
            <>
              <p className="form-help">This account is protected with Telegram 2FA. Enter the cloud password to finish.</p>
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Telegram 2FA password" type="password" autoComplete="current-password" />
              <button className="primary-button" type="button" disabled={busy || password.length === 0} onClick={confirmTwoFactor}>
                {busy ? 'Verifying…' : 'Verify 2FA'}
              </button>
            </>
          )}

          {error && <p className="login-error" role="alert">{error}</p>}
        </div>
      )}

      {stage === 'authorized' && (
        <div className="settings-card">
          <p className="form-help" style={{ margin: 0 }}>
            ✅ The private source is authorized and the login is stored on this device — the console will not ask again.
            Premium media keeps flowing through <code>/api/telegram/channels</code>; the MTProto session stays encrypted
            server-side and is refreshed on every use.
          </p>
        </div>
      )}
    </>
  )
}
