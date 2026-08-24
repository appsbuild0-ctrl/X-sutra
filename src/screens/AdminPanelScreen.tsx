import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScreenHeader } from '../components/ScreenHeader'
import { DownloadIcon, HeartIcon, LibraryIcon, ShieldIcon, TrashIcon, UserIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { useOnlineMembers } from '../hooks/useOnlineMembers'
import { clearPayQr, fileToDataUrl, readPayQr, writePayQr } from '../lib/payQr'


export function AdminPanelScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { account, saved, liked, follows, collections, downloads, clearLocalData, clearDownloads, preferences, updatePreferences, signOut, notify } = useApp()
  const onlineMembers = useOnlineMembers()
  const [qr, setQr] = useState(readPayQr)

  if (account?.role !== 'admin') {
    return (
      <section className="screen screen--admin">
        <ScreenHeader title="Admin panel" eyebrow="Restricted" />
        <div className="admin-locked">
          <span className="admin-locked__icon"><ShieldIcon size={26} /></span>
          <strong>Admin access required</strong>
          <p>Sign in with the built-in administrator account to open the panel.</p>
          <button className="primary-button primary-button--wide" type="button" onClick={() => navigate('/login')}>Go to sign in</button>
          <small className="admin-hint">Hint: username <b>admin</b> · password <b>admin123</b></small>
        </div>
      </section>
    )
  }

  return (
    <section className="screen screen--admin">
      <ScreenHeader title="Admin panel" eyebrow="Device administrator" actions={<button className="round-button" type="button" onClick={() => navigate('/you')} aria-label="Back to you">‹</button>} />
      <div className="admin-hero">
        <span className="admin-hero__icon"><ShieldIcon size={24} /></span>
        <div>
          <p className="eyebrow">Signed in</p>
          <h2>Admin</h2>
          <p>Built-in administrator · full local control on this device.</p>
        </div>
      </div>
      <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Live</p><h3>Presence</h3></div></div>
      <div className="admin-presence">
        <i />
        <div>
          <strong>{onlineMembers.toLocaleString('en-IN')}</strong>
          <span>members online now</span>
        </div>
        <small>simulated</small>
      </div>
      <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Device data</p><h3>Local stats</h3></div></div>
      <div className="admin-stats">
        <div><LibraryIcon size={18} /><strong>{saved.length}</strong><span>Saved</span></div>
        <div><HeartIcon size={18} /><strong>{liked.length}</strong><span>Likes</span></div>
        <div><UserIcon size={18} /><strong>{follows.length}</strong><span>Following</span></div>
        <div><LibraryIcon size={18} /><strong>{collections.length}</strong><span>Collections</span></div>
        <div><DownloadIcon size={18} /><strong>{downloads.length}</strong><span>Downloads</span></div>
        <div><ShieldIcon size={18} /><strong>{preferences.blockedTags.length}</strong><span>Blocked tags</span></div>
      </div>
      <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Payments</p><h3>QR code</h3></div></div>
      <div className="settings-card" style={{ padding: 14, marginBottom: 18 }}>
        {qr ? <img src={qr} alt="Payment QR" style={{ width: '100%', maxWidth: 220, margin: '0 auto 12px', borderRadius: 12 }} /> : <p className="form-help">Koi QR uploaded nahi.</p>}
        <label className="primary-button primary-button--wide">
          Upload QR
          <input className="sr-only" type="file" accept="image/*" onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            const data = await fileToDataUrl(file)
            writePayQr(data)
            setQr(data)
            notify('QR saved', 'success')
          }} />
        </label>
        {qr && <button className="secondary-button" type="button" style={{ width: '100%', marginTop: 8 }} onClick={() => { clearPayQr(); setQr(''); notify('QR removed') }}>Remove QR</button>}
      </div>
      <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Controls</p><h3>Admin actions</h3></div></div>
      <div className="quick-link-list">
        <button type="button" onClick={() => { clearDownloads(); notify('Download history cleared', 'success') }}>
          <span><TrashIcon size={19} /><strong>Clear download history</strong><small>Remove {downloads.length} record{downloads.length === 1 ? '' : 's'}</small></span><i>›</i>
        </button>
        <button type="button" onClick={() => { updatePreferences({ quality: 'hd', autoplay: true, muted: true, blockedTags: [] }); notify('Preferences reset to defaults', 'success') }}>
          <span><ShieldIcon size={19} /><strong>Reset preferences</strong><small>Quality, autoplay, mute, blocked tags</small></span><i>›</i>
        </button>
        <button type="button" onClick={clearLocalData}>
          <span><TrashIcon size={19} /><strong>Clear all local data</strong><small>Saves, likes, follows, collections, history</small></span><i>›</i>
        </button>
        <button type="button" onClick={() => { signOut(); navigate('/you') }}>
          <span><UserIcon size={19} /><strong>Sign out admin</strong><small>End this admin session</small></span><i>›</i>
        </button>
      </div>
      <div className="settings-card settings-card--about"><div className="about-row"><span className="about-x">X</span><span><strong>X-sutra</strong><small>Admin panel · device-local only</small></span></div><p>Admin actions apply to data stored on this device only. Public feed data always comes from the live public API.</p></div>
    </section>
  )
}
