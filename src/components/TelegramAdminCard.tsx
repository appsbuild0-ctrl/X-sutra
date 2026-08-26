import { useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  fetchTelegramStatus,
  sendTelegramOtp,
  TelegramAdminError,
  verifyTelegramOtp,
  verifyTelegramTwoFactor,
  type TelegramAuthStatus
} from '../lib/telegramAdmin'

type Stage = 'locked' | 'ready' | 'otp' | '2fa' | 'authorized'

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
  const [stage, setStage] = useState<Stage>('locked')
  const [status, setStatus] = useState<TelegramAuthStatus | null>(null)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  const unlock = () => void run(async () => {
    const next = fetchTelegramStatus(secret)
    const result = await next
    setUnlocked(secret)
    setStatus(result)
    setStage(result.connection.connected ? 'authorized' : 'ready')
    setSecret('')
  })

  const refresh = () => void run(async () => {
    const result = await fetchTelegramStatus(unlocked)
    setStatus(result)
    setStage(result.connection.connected ? 'authorized' : 'ready')
    setCode('')
    setPassword('')
  })

  const sendCode = () => void run(async () => {
    const result = await sendTelegramOtp(unlocked, phone)
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
    setCode('')
    setPassword('')
    notify('Private Telegram source connected', 'success')
    await refreshQuiet()
  })

  const confirmTwoFactor = () => void run(async () => {
    await verifyTelegramTwoFactor(unlocked, password)
    setStage('authorized')
    setPassword('')
    setCode('')
    notify('Private Telegram source connected', 'success')
    await refreshQuiet()
  })

  const refreshQuiet = async () => {
    try {
      setStatus(await fetchTelegramStatus(unlocked))
    } catch { /* keep the last known status */ }
  }

  const lock = () => {
    setUnlocked('')
    setSecret('')
    setStage('locked')
    setStatus(null)
    setPhone('')
    setCode('')
    setPassword('')
    setError('')
  }

  if (stage === 'locked') {
    return (
      <div className="premium-post-form settings-card" style={{ padding: 14 }}>
        <strong>Private Telegram Source 🔒</strong>
        <p className="form-help">
          Owner-only bootstrap for the private media backend. Enter the <code>ADMIN_SETUP_SECRET</code> to check the
          connection and authorize the source. The secret stays in memory for this tab only — it is never saved.
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
        <div className="home-header-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={refresh}>Refresh</button>
          <button className="text-button" type="button" onClick={lock}>Lock console</button>
        </div>
      </div>

      {stage !== 'authorized' && status?.configuration.configured && (
        <div className="premium-post-form settings-card" style={{ padding: 14 }}>
          <strong>Connect the owner account</strong>
          <p className="form-help">
            Telegram sends the login code to the phone configured on the server (<code>TELEGRAM_PHONE</code>). Only the
            configured owner identity (<code>ADMIN_TELEGRAM_USER_ID</code>) can be authorized.
          </p>

          {stage === 'ready' && (
            <>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91… (configured owner phone)" inputMode="tel" autoComplete="tel" />
              <button className="primary-button" type="button" disabled={busy || phone.trim().length === 0} onClick={sendCode}>
                {busy ? 'Sending…' : 'Send login code'}
              </button>
            </>
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
            ✅ The private source is authorized. Premium media keeps flowing through <code>/api/telegram/channels</code>;
            the MTProto session stays encrypted server-side.
          </p>
        </div>
      )}
    </>
  )
}
