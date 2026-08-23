import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandMark, EyeIcon, EyeOffIcon, ShieldIcon } from '../components/icons'
import { useApp, validEmail } from '../context/AppContext'

type LoginMode = 'signin' | 'signup'

export function LoginScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { signIn, signUp, account, notify } = useApp()
  const [mode, setMode] = useState<LoginMode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
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

    const cleanEmail = email.trim().toLowerCase()
    if (creating && !name.trim()) {
      setError('Enter your name')
      return
    }
    if (!validEmail(cleanEmail)) {
      setError('Enter a valid email address')
      return
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters')
      return
    }

    setBusy(true)
    const result = creating ? await signUp(name, cleanEmail, password) : await signIn(cleanEmail, password)
    setBusy(false)
    if (result.ok) {
      navigate('/you')
    } else {
      setError(result.error)
    }
  }

  if (account) {
    return (
      <section className="screen screen--login">
        <div className="login-card">
          <span className="login-card__mark"><BrandMark size={34} /></span>
          <p className="eyebrow">Local account</p>
          <h2>Already signed in</h2>
          <p className="login-card__lead">You are signed in as <strong>{account.name}</strong> ({account.email}).</p>
          <button className="primary-button primary-button--wide" type="button" onClick={() => navigate('/you')}>Go to your profile</button>
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
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              inputMode="email"
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
      </div>
    </section>
  )
}
