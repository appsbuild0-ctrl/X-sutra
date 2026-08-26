import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScreenHeader } from '../components/ScreenHeader'
import { TelegramAdminCard } from '../components/TelegramAdminCard'
import { DownloadIcon, HeartIcon, LibraryIcon, SettingsIcon, ShieldIcon, TrashIcon, UserIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { useOnlineMembers } from '../hooks/useOnlineMembers'
import { createUser, deleteUser, onAccountsChange, patchUser, publicUsers, resetUserPassword } from '../lib/accounts'
import { cacheHub, defaultHub, loadHub, saveHub, type AdminHub, type HubNotification } from '../lib/adminHub'
import { roleLabel } from '../lib/roles'
import type { UserRole } from '../types'
import { fetchPremiumCatalog, premiumAdmin, type PremiumCatalog } from '../lib/premium'
import { fileToDataUrl, writePayQr, clearPayQr } from '../lib/payQr'

type Tab = 'dash' | 'users' | 'videos' | 'telegram' | 'settings'

export function AdminPanelScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { account } = useApp()
  const [tab, setTab] = useState<Tab>('dash')
  const [hub, setHub] = useState<AdminHub>(defaultHub)
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)

  useEffect(() => {
    void loadHub().then(setHub)
    void fetchPremiumCatalog().then(setCatalog)
  }, [])

  useEffect(() => { if (!account) navigate('/login') }, [account, navigate])
  if (!account) {
    return <section className="screen screen--admin"><p className="form-help">Redirecting to login…</p></section>
  }
  if (account.role !== 'admin') {
    return (
      <section className="screen screen--admin">
        <ScreenHeader title="Access Denied" eyebrow="Admin only" />
        <div className="admin-locked"><strong>Access Denied</strong><p>Normal / Premium / VIP users cannot open the Admin Panel.</p></div>
      </section>
    )
  }

  const persist = async (next: AdminHub) => {
    setHub(cacheHub(next))
    writePayQr(next.qr)
    await saveHub(next)
  }

  return (
    <section className="screen screen--admin">
      <ScreenHeader title="Admin" eyebrow="X-sutra control" actions={<button className="round-button" type="button" onClick={() => navigate('/you')}>‹</button>} />
      {tab === 'dash' && <Dash hub={hub} catalog={catalog} />}
      {tab === 'users' && <Users />}
      {tab === 'videos' && <Videos catalog={catalog} setCatalog={setCatalog} hub={hub} persist={persist} />}
      {tab === 'telegram' && <TelegramAdminCard onConnected={() => navigate('/premium')} />}
      {tab === 'settings' && <Settings hub={hub} persist={persist} />}
      <nav className="admin-tabs" aria-label="Admin sections">
        {([['dash', 'Dashboard'], ['users', 'Users'], ['videos', 'Videos'], ['telegram', 'Telegram'], ['settings', 'Settings']] as const).map(([id, label]) => (
          <button key={id} className={tab === id ? 'is-active' : ''} type="button" onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
    </section>
  )
}

function Dash({ hub, catalog }: { hub: AdminHub; catalog: PremiumCatalog | null }): React.JSX.Element {
  const online = useOnlineMembers()
  const roster = publicUsers()
  const users = Math.max(hub.users.length, roster.length)
  const premium = roster.filter((user) => user.role === 'premium').length
  const vip = roster.filter((user) => user.role === 'vip').length
  const videos = catalog?.media.filter((item) => item.type === 'video').length ?? 0
  return (
    <>
      <div className="admin-stats">
        <div><UserIcon size={18} /><strong>{users}</strong><span>Total Users</span></div>
        <div><ShieldIcon size={18} /><strong>{premium}</strong><span>Premium</span></div>
        <div><HeartIcon size={18} /><strong>{vip}</strong><span>VIP</span></div>
        <div><LibraryIcon size={18} /><strong>{videos}</strong><span>Videos</span></div>
        <div><DownloadIcon size={18} /><strong>{catalog?.media.length ?? 0}</strong><span>Downloads*</span></div>
        <div><SettingsIcon size={18} /><strong>{online.toLocaleString('en-IN')}</strong><span>Online</span></div>
      </div>
      <p className="form-help">* Media items in the premium catalog. Home feed stays on the public API.</p>
    </>
  )
}

function Users(): React.JSX.Element {
  const { notify } = useApp()
  const [roster, setRoster] = useState(publicUsers)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('creator')
  const [error, setError] = useState('')
  useEffect(() => onAccountsChange(() => setRoster(publicUsers())), [])

  const create = async (forced?: UserRole) => {
    setError('')
    const result = await createUser({ username, password, role: forced || role })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setUsername('')
    setPassword('')
    setRoster(publicUsers())
    notify(`Account @${result.user?.username} created`, 'success')
  }

  return (
    <>
      <div className="premium-post-form settings-card" style={{ padding: 14, marginBottom: 12 }}>
        <strong>Create User</strong>
        <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" autoCapitalize="none" />
        <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" autoComplete="new-password" />
        <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
          <option value="normal">👤 Normal</option>
          <option value="creator">🪪 Creator</option>
          <option value="premium">⭐ Premium</option>
          <option value="vip">💎 VIP</option>
        </select>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="primary-button" type="button" onClick={() => void create()}>Create Account</button>
        <div className="home-header-actions">
          <button className="secondary-button" type="button" onClick={() => void create('premium')}>Create Premium ⭐</button>
          <button className="secondary-button" type="button" onClick={() => void create('vip')}>Create VIP 💎</button>
        </div>
      </div>
      <div className="settings-card">
        {roster.map((user) => (
          <div className="setting-row" key={user.username} style={{ flexWrap: 'wrap', gap: 8 }}>
            <span><strong>{user.username}</strong><small>{roleLabel(user.role)} · {user.status === 'off' ? 'Disabled' : 'Active'} · {user.createdAt.slice(0, 10)}</small></span>
            {user.username !== 'admin' && (
              <>
                <select value={user.role} onChange={(event) => {
                  const result = patchUser(user.username, { role: event.target.value as UserRole })
                  if (!result.ok) notify(result.error, 'error')
                  else { setRoster(publicUsers()); notify('Role updated', 'success') }
                }}>
                  <option value="normal">👤 Normal</option>
                  <option value="creator">🪪 Creator</option>
                  <option value="premium">⭐ Premium</option>
                  <option value="vip">💎 VIP</option>
                </select>
                <button className="text-button" type="button" onClick={() => { patchUser(user.username, { status: user.status === 'on' ? 'off' : 'on' }); setRoster(publicUsers()) }}>{user.status === 'off' ? 'Enable' : 'Disable'}</button>
                <button className="text-button" type="button" onClick={async () => {
                  const next = window.prompt('New password (min 4 characters)')
                  if (!next) return
                  const result = await resetUserPassword(user.username, next)
                  notify(result.ok ? 'Password reset' : result.error, result.ok ? 'success' : 'error')
                }}>Reset password</button>
                <button className="text-button" type="button" onClick={() => {
                  if (!window.confirm('Are you sure you want to delete this user?')) return
                  deleteUser(user.username)
                  setRoster(publicUsers())
                }}><TrashIcon size={16} /></button>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function Videos({ catalog, setCatalog, hub, persist }: { catalog: PremiumCatalog | null; setCatalog: (catalog: PremiumCatalog) => void; hub: AdminHub; persist: (hub: AdminHub) => Promise<void> }): React.JSX.Element {
  if (!catalog) return <p className="form-help">Loading videos…</p>
  return (
    <div className="settings-card">
      <div className="setting-row"><span><strong>Total Videos</strong></span><strong>{catalog.media.filter((item) => item.type === 'video').length}</strong></div>
      {catalog.media.map((item) => {
        const hidden = hub.hiddenVideos.includes(item.id)
        return (
          <div className="setting-row" key={item.id} style={{ flexWrap: 'wrap' }}>
            <span><strong>{item.title}</strong><small>{item.type}{hidden ? ' · hidden' : ''}</small></span>
            <button className="text-button" type="button" onClick={() => void persist({
              ...hub,
              hiddenVideos: hidden ? hub.hiddenVideos.filter((id) => id !== item.id) : [...hub.hiddenVideos, item.id]
            })}>{hidden ? 'Unhide' : 'Hide'}</button>
            <button className="text-button" type="button" onClick={async () => {
              if (!window.confirm('Delete this video?')) return
              const result = await premiumAdmin('deleteMedia', { id: item.id })
              if (result.ok && result.catalog) setCatalog(result.catalog)
            }}>Delete</button>
          </div>
        )
      })}
    </div>
  )
}

function Settings({ hub, persist }: { hub: AdminHub; persist: (hub: AdminHub) => Promise<void> }): React.JSX.Element {
  const [draft, setDraft] = useState(hub)
  useEffect(() => setDraft(hub), [hub])
  const card = draft.homeCard
  return (
    <div className="premium-post-form">
      <h3>Payment QR Code</h3>
      {draft.qr ? <img src={draft.qr} alt="QR" style={{ width: 180, borderRadius: 12, background: '#fff' }} /> : <p className="form-help">No QR uploaded.</p>}
      <label className="primary-button primary-button--wide">
        Upload / Replace QR
        <input className="sr-only" type="file" accept="image/*" onChange={async (event) => {
          const file = event.target.files?.[0]
          if (!file) return
          const qr = await fileToDataUrl(file)
          const next = { ...draft, qr }
          setDraft(next)
          writePayQr(qr)
          await persist(next)
        }} />
      </label>
      {draft.qr && <button className="secondary-button" type="button" onClick={async () => { clearPayQr(); const next = { ...draft, qr: '' }; setDraft(next); await persist(next) }}>Delete QR</button>}

      <h3>Premium ⭐</h3>
      <PlanFields plan={draft.plans.premium} onChange={(premium) => setDraft({ ...draft, plans: { ...draft.plans, premium } })} />
      <h3>VIP 💎</h3>
      <PlanFields plan={draft.plans.vip} onChange={(vip) => setDraft({ ...draft, plans: { ...draft.plans, vip } })} />

      <h3>Home Card Manager</h3>
      <input value={card.label} onChange={(event) => setDraft({ ...draft, homeCard: { ...card, label: event.target.value } })} placeholder="Small label" />
      <input value={card.online} onChange={(event) => setDraft({ ...draft, homeCard: { ...card, online: event.target.value } })} placeholder="Online / status text" />
      <input value={card.title} onChange={(event) => setDraft({ ...draft, homeCard: { ...card, title: event.target.value } })} placeholder="Main title" />
      <textarea value={card.description} onChange={(event) => setDraft({ ...draft, homeCard: { ...card, description: event.target.value } })} placeholder="Description" />
      <input value={card.buttonText} onChange={(event) => setDraft({ ...draft, homeCard: { ...card, buttonText: event.target.value } })} placeholder="Button text" />
      <input value={card.buttonUrl} onChange={(event) => setDraft({ ...draft, homeCard: { ...card, buttonUrl: event.target.value } })} placeholder="Button URL" />
      <input value={card.secondaryText} onChange={(event) => setDraft({ ...draft, homeCard: { ...card, secondaryText: event.target.value } })} placeholder="Second button text" />
      <input value={card.secondaryUrl} onChange={(event) => setDraft({ ...draft, homeCard: { ...card, secondaryUrl: event.target.value } })} placeholder="Second button URL" />
      <label className="primary-button">Upload card image<input className="sr-only" type="file" accept="image/*" onChange={async (event) => {
        const file = event.target.files?.[0]
        if (!file) return
        setDraft({ ...draft, homeCard: { ...card, image: await fileToDataUrl(file) } })
      }} /></label>
      <label className="setting-row"><span><strong>Dark overlay</strong></span><input className="switch" type="checkbox" checked={card.overlay} onChange={(event) => setDraft({ ...draft, homeCard: { ...card, overlay: event.target.checked } })} /></label>
      <label className="setting-row"><span><strong>Card enabled</strong></span><input className="switch" type="checkbox" checked={card.enabled} onChange={(event) => setDraft({ ...draft, homeCard: { ...card, enabled: event.target.checked } })} /></label>
      <div className="home-intro" style={card.image ? { backgroundImage: `linear-gradient(180deg, rgba(8,6,6,.2), rgba(8,6,6,.75)), url(${card.image})`, backgroundSize: 'cover' } : undefined}>
        <div><p className="home-intro__kicker">{card.label}</p><h2>{card.title}</h2><p>{card.description}</p></div>
        {card.online && <span className="online-pill">{card.online}</span>}
      </div>
      <p className="form-help">Live Preview</p>

      <h3>Notifications</h3>
      <NotifyEditor hub={draft} setDraft={setDraft} />

      <button className="primary-button primary-button--wide" type="button" onClick={() => void persist(draft)}>Save Changes</button>
      <button className="secondary-button" type="button" onClick={() => setDraft(hub)}>Reset</button>
    </div>
  )
}

function PlanFields({ plan, onChange }: { plan: AdminHub['plans']['premium']; onChange: (plan: AdminHub['plans']['premium']) => void }): React.JSX.Element {
  return (
    <>
      <input value={plan.name} onChange={(event) => onChange({ ...plan, name: event.target.value })} placeholder="Plan name" />
      <input value={plan.price} onChange={(event) => onChange({ ...plan, price: event.target.value })} placeholder="Price" />
      <textarea value={plan.description} onChange={(event) => onChange({ ...plan, description: event.target.value })} placeholder="Description" />
      <label className="setting-row"><span><strong>Enabled</strong></span><input className="switch" type="checkbox" checked={plan.enabled} onChange={(event) => onChange({ ...plan, enabled: event.target.checked })} /></label>
    </>
  )
}

function NotifyEditor({ hub, setDraft }: { hub: AdminHub; setDraft: (hub: AdminHub) => void }): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [link, setLink] = useState('')
  const [buttonText, setButtonText] = useState('View Update')
  return (
    <>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" />
      <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Message" />
      <input value={link} onChange={(event) => setLink(event.target.value)} placeholder="Optional link" />
      <input value={buttonText} onChange={(event) => setButtonText(event.target.value)} placeholder="Button text" />
      <button className="secondary-button" type="button" onClick={() => {
        if (!title.trim() || !message.trim()) return
        const item: HubNotification = { id: `nt-${Date.now()}`, title: title.trim(), message: message.trim(), link: link.trim(), buttonText: buttonText.trim() || 'View Update', active: true, createdAt: new Date().toISOString() }
        setDraft({ ...hub, notifications: [item, ...hub.notifications] })
        setTitle(''); setMessage(''); setLink('')
      }}>+ Create Notification</button>
      {hub.notifications.map((item) => (
        <div className="setting-row" key={item.id} style={{ flexWrap: 'wrap' }}>
          <span><strong>{item.title}</strong><small>{item.message}</small></span>
          <button className="text-button" type="button" onClick={() => setDraft({ ...hub, notifications: hub.notifications.map((entry) => entry.id === item.id ? { ...entry, active: !entry.active } : entry) })}>{item.active ? 'Disable' : 'Enable'}</button>
          <button className="text-button" type="button" onClick={() => setDraft({ ...hub, notifications: hub.notifications.filter((entry) => entry.id !== item.id) })}>Delete</button>
        </div>
      ))}
    </>
  )
}
