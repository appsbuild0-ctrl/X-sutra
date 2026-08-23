import { useState } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import { BrandMark, CheckIcon, DownloadIcon, LibraryIcon, LogOutIcon, SettingsIcon, UserIcon } from '../components/icons'
import { useApp } from '../context/AppContext'

export function YouScreen(): React.JSX.Element {
  const {
    profileName,
    setProfileName,
    clearProfile,
    saved,
    downloads,
    preferences,
    updatePreferences,
    notify
  } = useApp()
  const [name, setName] = useState(profileName)
  const [editing, setEditing] = useState(!profileName)

  const submitProfile = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!name.trim()) {
      notify('Enter a name to continue')
      return
    }
    setProfileName(name)
    setEditing(false)
  }

  if (!profileName || editing) {
    return (
      <section className="screen screen--you">
        <ScreenHeader title="You" eyebrow="Your local space" />
        <div className="local-login">
          <span className="local-login__mark"><BrandMark size={50} /></span>
          <p className="eyebrow">Welcome to X-sutra</p>
          <h2>Make this space yours.</h2>
          <p>Create a simple local profile. It only saves a display name on this device—there is no external account sign-in.</p>
          <form onSubmit={submitProfile}>
            <label htmlFor="profile-name">Display name</label>
            <div className="local-login__input">
              <UserIcon size={20} />
              <input
                id="profile-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                maxLength={32}
                autoComplete="nickname"
                autoFocus
              />
            </div>
            <button className="primary-button primary-button--wide" type="submit">Continue</button>
          </form>
          <div className="privacy-line"><CheckIcon size={16} /> No password · No third-party login · Kept on this device</div>
        </div>
      </section>
    )
  }

  return (
    <section className="screen screen--you">
      <ScreenHeader title="You" eyebrow="Your local space" actions={<button className="round-button" type="button" onClick={() => setEditing(true)} aria-label="Edit local profile"><SettingsIcon size={19} /></button>} />

      <div className="profile-card">
        <span className="profile-card__avatar">{profileName.slice(0, 1).toUpperCase()}</span>
        <div className="profile-card__copy">
          <p className="eyebrow">Local profile</p>
          <h2>{profileName}</h2>
          <span>This device only</span>
        </div>
        <button className="text-button" type="button" onClick={() => setEditing(true)}>Edit</button>
      </div>

      <div className="profile-stats">
        <div><LibraryIcon size={19} /><strong>{saved.length}</strong><span>Saved</span></div>
        <div><DownloadIcon size={19} /><strong>{downloads.length}</strong><span>Downloads</span></div>
      </div>

      <div className="section-heading section-heading--spaced">
        <div>
          <p className="eyebrow">Playback & saving</p>
          <h3>Preferences</h3>
        </div>
      </div>
      <div className="settings-card">
        <label className="setting-row">
          <span>
            <strong>Download quality</strong>
            <small>Used for every new download</small>
          </span>
          <select value={preferences.quality} onChange={(event) => updatePreferences({ quality: event.target.value as 'hd' | 'sd' })}>
            <option value="hd">HD</option>
            <option value="sd">SD</option>
          </select>
        </label>
        <label className="setting-row">
          <span>
            <strong>Autoplay in player</strong>
            <small>Start video when a clip opens</small>
          </span>
          <input
            className="switch"
            type="checkbox"
            checked={preferences.autoplay}
            onChange={(event) => updatePreferences({ autoplay: event.target.checked })}
            aria-label="Autoplay in player"
          />
        </label>
      </div>

      <div className="settings-card settings-card--about">
        <div className="about-row"><BrandMark size={24} /><span><strong>X-sutra</strong><small>Private, local-first browser</small></span></div>
        <p>Public browsing works without connecting an external account. Saved clips, profile name, and download history are kept locally.</p>
      </div>

      <button className="danger-button" type="button" onClick={() => {
        clearProfile()
        setName('')
        setEditing(true)
      }}><LogOutIcon size={18} /> Remove local profile</button>
    </section>
  )
}
