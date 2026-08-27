import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import { currentUser } from '../lib/telegramLogin'
import { TelegramLoginButton } from './TelegramLoginButton'

/**
 * Server-managed tabs (Uploads, Accounts) need a Telegram admin session, not the
 * old device-local password. When there isn't one, show a single Connect button
 * instead of a confusing 401: the first real Telegram login bootstraps the
 * owner-admin, and later logins are checked against xs_admin_telegram_ids.
 */
export function TelegramAdminGate({ children, heading = 'Telegram admin' }: { children: React.ReactNode; heading?: string }): React.JSX.Element {
  const { account, signInWithTelegram } = useApp()
  const [telegramUser, setTelegramUser] = useState(currentUser)

  useEffect(() => {
    setTelegramUser(currentUser())
  }, [account])

  if (telegramUser) return <>{children}</>

  return (
    <div className="settings-card">
      <strong>{heading}</strong>
      <p className="form-help">
        This section is managed with your Telegram account, not the device password. Press the button below and confirm
        in Telegram — the first account to connect becomes the admin, so nothing sensitive is ever typed here.
      </p>
      <TelegramLoginButton
        label="Connect with Telegram"
        onAuth={async (auth) => {
          const result = await signInWithTelegram(auth)
          if (result.ok) setTelegramUser(currentUser())
        }}
      />
    </div>
  )
}
