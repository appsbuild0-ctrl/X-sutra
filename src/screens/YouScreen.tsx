import { useNavigate } from 'react-router-dom'
import { ScreenHeader } from '../components/ScreenHeader'
import { DownloadIcon, LibraryIcon, SettingsIcon, UserIcon } from '../components/icons'
import { useApp } from '../context/AppContext'

export function YouScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { saved, follows, downloads } = useApp()

  return (
    <section className="screen screen--you">
      <ScreenHeader title="You" eyebrow="Local controls" actions={<button className="round-button" type="button" onClick={() => navigate('/settings')} aria-label="Open settings"><SettingsIcon size={19} /></button>} />
      <div className="guest-card">
        <span className="guest-card__avatar"><UserIcon size={27} /></span>
        <div><p className="eyebrow">Guest mode</p><h2>Public feed access</h2><p>No login is active. Your saves, follows and preferences stay on this device.</p></div>
      </div>
      <div className="profile-stats"><div><LibraryIcon size={19} /><strong>{saved.length}</strong><span>Saved</span></div><div><UserIcon size={19} /><strong>{follows.length}</strong><span>Following</span></div><div><DownloadIcon size={19} /><strong>{downloads.length}</strong><span>Downloads</span></div></div>
      <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Quick access</p><h3>Your local data</h3></div></div>
      <div className="quick-link-list">
        <button type="button" onClick={() => navigate('/library')}><span><LibraryIcon size={19} /><strong>Library</strong><small>Saved clips, collections and follows</small></span><i>›</i></button>
        <button type="button" onClick={() => navigate('/downloads')}><span><DownloadIcon size={19} /><strong>Download history</strong><small>Public files sent to your device</small></span><i>›</i></button>
        <button type="button" onClick={() => navigate('/settings')}><span><SettingsIcon size={19} /><strong>Preferences</strong><small>Quality, player and blocked tags</small></span><i>›</i></button>
      </div>
      <div className="settings-card settings-card--about"><div className="about-row"><span className="about-x">X</span><span><strong>X-sutra</strong><small>Real public data · local controls</small></span></div><p>Sign-in can be added later. This build intentionally uses only temporary public API access and never asks for an external password or account token.</p></div>
    </section>
  )
}
