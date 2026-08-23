import { useState, type FormEvent } from 'react'
import { BrandMark } from '../components/icons'

interface LoginScreenProps {
  onAuthenticated: () => void
}

/** Simple local access gate for the supplied administrator credential. */
export function LoginScreen({ onAuthenticated }: LoginScreenProps): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (username.trim() !== 'admin' || password !== 'admin') {
      setError('Incorrect username or password.')
      return
    }
    window.sessionStorage.setItem('x-sutra.authenticated', 'true')
    onAuthenticated()
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand" aria-hidden="true"><BrandMark size={38} /></div>
        <p className="eyebrow">X-sutra access</p>
        <h1 id="login-title">Welcome back.</h1>
        <p className="login-card__intro">Sign in to continue to your public media browser.</p>

        <form className="login-form" onSubmit={submit}>
          <label>
            <span>Username</span>
            <input
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => { setUsername(event.target.value); setError('') }}
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => { setPassword(event.target.value); setError('') }}
              required
            />
          </label>
          {error && <p className="login-form__error" role="alert">{error}</p>}
          <button className="login-form__submit" type="submit">Sign in</button>
        </form>
      </section>
    </main>
  )
}
