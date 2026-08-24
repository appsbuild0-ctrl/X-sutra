import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandMark, EyeIcon, EyeOffIcon, ShieldIcon } from '../components/icons'
import { useApp, validUsername } from '../context/AppContext'

type LoginMode = 'signin' | 'signup'

export function LoginScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { signIn, signUp, signOut, account, notify } = useApp()
  const [mode, setMode] = useState<LoginMode>('signin')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const creating = mode === 'signup'

  const switchMode = (next: LoginMode): void => {
    setMode(next)
    setError('')
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setError('')

    const cleanUsername = username.trim().toLowerCase()
    if (creating && !name.trim()) {
      setError('Enter your name')
      return
    }
    if (cleanUsername === 'admin') {
      if (password !== 'admin123' && password !== 'admin') {
        setError('Admin password is admin123')
        return
      }
    } else if (!validUsername(cleanUsername)) {
      setError('Username: 3-20 letters, numbers, dot or underscore')
      return
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters')
      return
    }

    setBusy(true)
    try {
      const result = creating ? await signUp(name, cleanUsername, password) : await signIn(cleanUsername, password)
      if (result.ok) {
        navigate(cleanUsername === 'admin' ? '/admin' : '/you')
      } else {
        setError(result.error)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  if (account) {
    return (
      <section className="screen screen--login">
        <div className="login-card">
          <span className="login-card__mark"><BrandMark size={34} /></span>
          <p className="eyebrow">{account.role === 'admin' ? 'Admin session' : 'Local account'}</p>
          <h2>Already signed in</h2>
          <p className="login-card__lead">You are signed in as <strong>{account.name}</strong> (@{account.username}).</p>
          <button className="primary-button primary-button--wide" type="button" onClick={() => navigate(account.role === 'admin' ? '/admin' : '/you')}>{account.role === 'admin' ? 'Open admin panel' : 'Go to your profile'}</button>
          <button className="secondary-button" type="button" onClick={signOut}>Sign out</button>
        </div>
      </section>
    )
  }

  return (
    <section className="screen screen--login">
      <div className="login-card">
        <span className="login-card__mark"><BrandMark size={34} /></span>
        <p className="eyebrow">{creating ? 'Create local account' : 'Welcome back'}</p>
        <h2>{creating ? 'Set up your profile' : 'Sign in to X-sutra'}</h2>
        <p className="login-card__lead">
          {creating
            ? 'Your account lives only on this device — nothing is uploaded anywhere.'
            : 'Unlock your local saves, follows and preferences on this device.'}
        </p>

        <div className="segmented login-segmented" role="tablist" aria-label="Login mode">
          <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'is-active' : ''} onClick={() => switchMode('signin')}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'is-active' : ''} onClick={() => switchMode('signup')}>Create account</button>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          {creating && (
            <label className="login-field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                autoComplete="name"
                maxLength={40}
              />
            </label>
          )}

          <label className="login-field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={creating ? 'Choose a username' : 'username (try admin)'}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={20}
            />
          </label>

          <label className="login-field">
            <span>Password</span>
            <span className="login-field__shell">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={creating ? 'Choose a password (4+ characters)' : 'Your password'}
                autoComplete={creating ? 'new-password' : 'current-password'}
              />
              <button
                className={`login-eye${showPassword ? ' is-visible' : ''}`}
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
              </button>
            </span>
          </label>

          {error && <p className="login-error" role="alert">{error}</p>}

          <button className="primary-button primary-button--wide" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : creating ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <button
          className="text-button login-swap"
          type="button"
          onClick={() => { notify('Continuing in guest mode'); navigate('/you') }}
        >
          Continue as guest →
        </button>

        <p className="login-note">
          <ShieldIcon size={13} /> Local-only login. Your password is hashed on this device and never sent to any server.
        </p>
        <p className="login-note login-note--admin">
          <ShieldIcon size={13} /> Admin access: username <strong>admin</strong> · password <strong>admin123</strong> — opens the admin panel directly.
        </p>
      </div>
    </section>
  )
}
