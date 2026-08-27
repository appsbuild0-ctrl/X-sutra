import { useEffect, useRef, useState } from 'react'
import {
  fetchTelegramLoginConfig,
  renderTelegramWidget,
  TelegramLoginError,
  type TelegramWidgetUser
} from '../lib/telegramLogin'

/**
 * Telegram's official login button.
 *
 * The bot token never reaches the browser: the backend publishes only the bot's
 * public @username, the widget is served by telegram.org, and the signed
 * payload it returns is verified server-side. If the bot's domain is not set
 * with @BotFather, Telegram itself refuses to render the button — the message
 * below explains that instead of failing silently.
 */
export function TelegramLoginButton({
  onAuth,
  label = 'Login with Telegram'
}: {
  onAuth: (user: TelegramWidgetUser) => void | Promise<void>
  label?: string
}): React.JSX.Element {
  const container = useRef<HTMLDivElement | null>(null)
  const latest = useRef(onAuth)
  latest.current = onAuth
  const [notice, setNotice] = useState('Loading Telegram login…')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let dispose: (() => void) | null = null
    let cancelled = false

    void fetchTelegramLoginConfig()
      .then((config) => {
        if (cancelled || !container.current) return
        if (!config.enabled || !config.botUsername) {
          setNotice(config.error || 'Telegram login is not configured on the server yet (TELEGRAM_BOT_TOKEN).')
          return
        }
        dispose = renderTelegramWidget({
          botUsername: config.botUsername,
          container: container.current,
          onAuth: (user) => { void latest.current(user) }
        })
        setReady(true)
        setNotice('')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setNotice(error instanceof TelegramLoginError ? error.message : 'Telegram login is unavailable right now.')
      })

    return () => {
      cancelled = true
      dispose?.()
    }
  }, [])

  return (
    <div className="telegram-login">
      <span className="telegram-login__label">{label}</span>
      <div ref={container} className="telegram-login__widget" />
      {!ready && notice && <p className="form-help telegram-login__notice">{notice}</p>}
    </div>
  )
}
