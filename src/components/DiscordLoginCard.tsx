/**
 * DiscordLoginCard — the "real Discord web login" UI.
 *
 * Unconnected: one blurple button that opens the Discord sign-in page.
 * Connected: a compact chip with the Discord avatar + username and a
 * logout action. The session persists, so this chip stays put between visits.
 */

import { useDiscordLogin } from '../context/DiscordLoginContext'

/** The official Discord mark, simplified to a single path. */
export function DiscordLogo({ size = 24 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size * (96.36 / 127.14)} viewBox="0 0 127.14 96.36" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M127.07 13.39A118.76 118.76 0 0 0 97.55 3.24a.28.28 0 0 0-.3.15c-2.12 3.86-4.49 8.03-6.19 11.95-18.58-2.22-37.07 0-55.59 2.09-1.78-3.97-4.24-8.14-6.44-12a.27.27 0 0 0-.3-.15A118.5 118.5 0 0 0 0 13.38a.32.32 0 0 0-.16.21C-.98 36.45 1.45 59.3 8.74 81.41a.28.28 0 0 0 .12.15 118.75 118.75 0 0 0 36.34 18.26.29.29 0 0 0 .31-.11c2.76-3.78 5.23-7.82 7.38-12.03a.28.28 0 0 0-.16-.39 94.2 94.2 0 0 1-13.27-6.25.28.28 0 0 1-.04-.47c.89-.68 1.75-1.39 2.58-2.1a.27.27 0 0 1 .29-.05c21.43 9.89 44.7 9.89 65.97 0a.27.27 0 0 1 .29.05c.83.71 1.7 1.42 2.58 2.1a.28.28 0 0 1-.04.47 93.9 93.9 0 0 1-13.28 6.25.28.28 0 0 0-.15.39c2.2 4.21 4.66 8.25 7.38 12.03a.28.28 0 0 0 .3.11 118.5 118.5 0 0 0 36.36-18.26.29.29 0 0 0 .12-.15c7.65-22.82 9.47-45.74 8.45-68.62a.29.29 0 0 0-.14-.22ZM49.51 68.17c-6.19 0-11.22-5.53-11.22-12.32s5-12.32 11.22-12.32c6.25 0 11.28 5.55 11.22 12.32 0 6.79-5 12.32-11.22 12.32Zm37.97 0c-6.19 0-11.22-5.53-11.22-12.32s5-12.32 11.22-12.32c6.25 0 11.28 5.55 11.22 12.32 0 6.79-5 12.32-11.22 12.32Z" />
    </svg>
  )
}

export function DiscordLoginCard({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const { user, busy, error, login, logout, clearError } = useDiscordLogin()

  if (user) {
    return (
      <div className="discord-chip" title={`Logged in with Discord as @${user.username}`}>
        <span className="discord-chip__avatar" aria-hidden="true">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <DiscordLogo size={14} />}
        </span>
        <span className="discord-chip__name">
          <DiscordLogo size={13} />
          <span>{user.displayName}</span>
          <small>@{user.username}</small>
        </span>
        <button type="button" className="discord-chip__logout" onClick={logout} title="Log out of Discord">
          Logout
        </button>
      </div>
    )
  }

  return (
    <div className={`discord-login-card ${compact ? 'discord-login-card--compact' : ''}`}>
      <div className="discord-login-card__head">
        <span className="discord-login-card__mark"><DiscordLogo size={compact ? 18 : 26} /></span>
        <div>
          <strong>Discord login</strong>
          <small>{compact ? 'Connect your Discord account' : 'Real Discord web login — one time only'}</small>
        </div>
      </div>
      {!compact && (
        <p className="form-help">
          Sign in with your normal Discord account. Ek baar login karne ke baad session is device pe
          save rehta hai — baar baar login screen nahi aayegi.
        </p>
      )}
      <button type="button" className="discord-login-button" onClick={login} disabled={busy}>
        <DiscordLogo size={20} />
        <span>{busy ? 'Opening Discord…' : 'Login with Discord'}</span>
      </button>
      {error && (
        <p className="login-error" role="alert" onClick={clearError}>
          {error}
        </p>
      )}
    </div>
  )
}
