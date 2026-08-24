import { useNavigate } from 'react-router-dom'
import { ScreenHeader } from '../components/ScreenHeader'
import { DownloadIcon, HeartIcon, LibraryIcon, SettingsIcon, ShieldIcon, UserIcon } from '../components/icons'
import { useApp } from '../context/AppContext'

export function YouScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { saved, liked, follows, downloads, account, signOut } = useApp()
  const isAdmin = account?.role === 'admin'

  return (
    <section className="screen screen--you">
      <ScreenHeader title="You" eyebrow={account ? `Signed in · @${account.username}` : 'Local controls'} actions={<button className="round-button" type="button" onClick={() => navigate('/settings')} aria-label="Open settings"><SettingsIcon size={19} /></button>} />
      {account ? (
        <div className="guest-card">
          <span className="guest-card__avatar"><UserIcon size={27} /></span>
          <div>
            <p className="eyebrow">Local account</p>
            <h2>{account.name}</h2>
            <p>Signed in on this device. Your saves, follows and preferences stay local.</p>
            <div className="guest-card__actions">
              <button className="secondary-button" type="button" onClick={signOut}>Sign out</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="guest-card">
          <span className="guest-card__avatar"><UserIcon size={27} /></span>
          <div>
            <p className="eyebrow">Guest mode</p>
            <h2>Public feed access</h2>
            <p>No login is active. Your saves, follows and preferences stay on this device.</p>
            <div className="guest-card__actions">
              <button className="secondary-button" type="button" onClick={() => navigate('/login')}>Sign in / Create account</button>
            </div>
          </div>
        </div>
      )}
      <div className="profile-stats">
        <button type="button" onClick={() => navigate('/library?tab=saved')}><LibraryIcon size={19} /><strong>{saved.length}</strong><span>Saved</span></button>
        <button type="button" onClick={() => navigate('/library?tab=likes')}><HeartIcon size={19} /><strong>{liked.length}</strong><span>Likes</span></button>
        <button type="button" onClick={() => navigate('/library?tab=following')}><UserIcon size={19} /><strong>{follows.length}</strong><span>Following</span></button>
        <button type="button" onClick={() => navigate('/downloads')}><DownloadIcon size={19} /><strong>{downloads.filter((record) => record.status === 'done' || record.status === 'opened').length}</strong><span>Downloads</span></button>
      </div>

      <button className={`admin-link${isAdmin ? ' is-admin' : ''}`} type="button" onClick={() => navigate('/admin')} aria-label="Open admin panel">
        <ShieldIcon size={19} />
        <span><strong>Admin panel</strong><small>{isAdmin ? 'Signed in as Admin — open controls' : 'Requires admin sign in (admin / admin)'}</small></span>
        <i>›</i>
      </button>

      <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Quick access</p><h3>Your local data</h3></div></div>
      <div className="quick-link-list">
        <button type="button" onClick={() => navigate('/library')}><span><LibraryIcon size={19} /><strong>Library</strong><small>Saved clips, collections and follows</small></span><i>›</i></button>
        <button type="button" onClick={() => navigate('/downloads')}><span><DownloadIcon size={19} /><strong>Download history</strong><small>Public files sent to your device</small></span><i>›</i></button>
        <button type="button" onClick={() => navigate('/settings')}><span><SettingsIcon size={19} /><strong>Preferences</strong><small>Quality, player and blocked tags</small></span><i>›</i></button>
      </div>
      <div className="settings-card settings-card--about"><div className="about-row"><span className="about-x">X</span><span><strong>X-sutra</strong><small>Real public data · local controls</small></span></div><p>Local-only login is optional. This build uses temporary public API access and never sends your password or an external account token anywhere.</p></div>
    </section>
  )
}
