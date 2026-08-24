import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScreenHeader } from '../components/ScreenHeader'
import { DownloadIcon, HeartIcon, LibraryIcon, ShieldIcon, SparkIcon, TrashIcon, UserIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { useOnlineMembers } from '../hooks/useOnlineMembers'
import { addPremiumPost } from '../lib/premium'

/** Device administrator tools. Opens with the built-in admin / admin login. */
export function AdminPanelScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { account, saved, liked, follows, collections, downloads, clearLocalData, clearDownloads, preferences, updatePreferences, signOut, notify } = useApp()
  const onlineMembers = useOnlineMembers()
  const [postTitle, setPostTitle] = useState('')
  const [postUrl, setPostUrl] = useState('')
  const [postThumb, setPostThumb] = useState('')
  const [posting, setPosting] = useState(false)

  const submitPost = async (): Promise<void> => {
    if (posting) return
    const result = await addPremiumPost('admin123', postTitle, postUrl.trim(), postThumb.trim())
    if (result.ok) {
      notify('Premium post published', 'success')
      setPostTitle('')
      setPostUrl('')
      setPostThumb('')
    } else {
      notify(result.error ?? 'Could not publish', 'error')
    }
    setPosting(false)
  }

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

      <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Publish</p><h3>Post to Premium</h3></div><SparkIcon size={18} /></div>
      <div className="premium-post-form">
        <input value={postTitle} onChange={(e) => setPostTitle(e.target.value)} placeholder="Title (e.g. Exclusive clip)" maxLength={80} />
        <input value={postUrl} onChange={(e) => setPostUrl(e.target.value)} placeholder="Direct video link (https://...)" inputMode="url" autoCapitalize="none" spellCheck={false} />
        <input value={postThumb} onChange={(e) => setPostThumb(e.target.value)} placeholder="Thumbnail link (optional)" inputMode="url" autoCapitalize="none" spellCheck={false} />
        <button className="primary-button primary-button--wide" type="button" disabled={posting || !postUrl.trim()} onClick={() => { setPosting(true); void submitPost() }}>
          {posting ? 'Publishing…' : 'Publish to Premium'}
        </button>
        <p className="form-help">Upload anywhere (CloudGate share link, direct mp4, RedGifs CDN) and paste the link — members see it instantly in the Premium tab.</p>
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
