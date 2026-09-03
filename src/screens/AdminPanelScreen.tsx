import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScreenHeader } from '../components/ScreenHeader'
import { DownloadIcon, HeartIcon, LibraryIcon, SettingsIcon, ShieldIcon, TrashIcon, UserIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { useOnlineMembers } from '../hooks/useOnlineMembers'
import { createUser, deleteUser, onAccountsChange, patchUser, publicUsers, resetUserPassword } from '../lib/accounts'
import { commitHub, defaultHub, loadHub, type AdminHub, type HomeCardConfig, type HubNotification, type PlanInfo } from '../lib/adminHub'
import { fileToDataUrl } from '../lib/payQr'
import { roleLabel } from '../lib/roles'
import type { UserRole } from '../types'
import { fetchPremiumCatalog, premiumAdmin, type PremiumCatalog } from '../lib/premium'

type Tab = 'dash' | 'users' | 'videos' | 'qr' | 'plans' | 'homecard' | 'notifications'

const TABS: ReadonlyArray<[Tab, string]> = [
  ['dash', 'Dashboard'],
  ['users', 'Users'],
  ['videos', 'Videos'],
  ['qr', 'QR Code'],
  ['plans', 'Plans'],
  ['homecard', 'Home Card'],
  ['notifications', 'Notifications']
]

export function AdminPanelScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { account } = useApp()
  const [tab, setTab] = useState<Tab>('dash')
  const [hub, setHub] = useState<AdminHub>(defaultHub)
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)

  useEffect(() => {
    void loadHub().then(setHub)
    void fetchPremiumCatalog().then(setCatalog).catch(() => setCatalog(null))
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

  const save = async (next: AdminHub): Promise<void> => {
    const committed = await commitHub(next)
    setHub(committed)
  }

  return (
    <section className="screen screen--admin">
      <ScreenHeader title="Admin" eyebrow="RedGrab Control" actions={<button className="round-button" type="button" onClick={() => navigate('/you')}>‹</button>} />
      {tab === 'dash' && <Dash hub={hub} catalog={catalog} />}
      {tab === 'users' && <Users />}
      {tab === 'videos' && <Videos catalog={catalog} hub={hub} save={save} onCatalog={(next) => setCatalog(next)} />}
      {tab === 'qr' && <QrTab hub={hub} save={save} />}
      {tab === 'plans' && <PlansTab hub={hub} save={save} />}
      {tab === 'homecard' && <HomeCardTab hub={hub} save={save} />}
      {tab === 'notifications' && <NotificationsTab hub={hub} save={save} />}
      <nav className="admin-tabs" aria-label="Admin sections">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'is-active' : ''} type="button" onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
    </section>
  )
}

function eq(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Shared Save / Undo bar. The Save button is only live while something is
 *  dirty; otherwise it reads "Saved ✓". Undo reverts the local draft. */
function SaveBar({ dirty, saving, onSave, onUndo, busy }: { dirty: boolean; saving?: boolean; onSave: () => void; onUndo: () => void; busy?: boolean }): React.JSX.Element {
  return (
    <div className="save-row">
      <button className="primary-button primary-button--wide" type="button" disabled={!dirty || saving || busy} onClick={onSave}>
        {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved ✓'}
      </button>
      <button className="secondary-button" type="button" disabled={!dirty} onClick={onUndo}>Undo</button>
    </div>
  )
}

function Dash({ hub, catalog }: { hub: AdminHub; catalog: PremiumCatalog | null }): React.JSX.Element {
  const online = useOnlineMembers()
  const roster = publicUsers()
  const hubUsers = Array.isArray(hub.users) ? hub.users : []
  const media = Array.isArray(catalog?.media) ? catalog!.media : []
  const users = Math.max(hubUsers.length, roster.length)
  const premium = roster.filter((user) => user.role === 'premium').length
  const vip = roster.filter((user) => user.role === 'vip').length
  const videos = media.filter((item) => item.type === 'video').length
  return (
    <>
      <div className="admin-stats">
        <div><UserIcon size={18} /><strong>{users}</strong><span>Total Users</span></div>
        <div><ShieldIcon size={18} /><strong>{premium}</strong><span>Premium</span></div>
        <div><HeartIcon size={18} /><strong>{vip}</strong><span>VIP</span></div>
        <div><LibraryIcon size={18} /><strong>{videos}</strong><span>Videos</span></div>
        <div><DownloadIcon size={18} /><strong>{media.length}</strong><span>Downloads*</span></div>
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

function Videos({ catalog, hub, save, onCatalog }: { catalog: PremiumCatalog | null; hub: AdminHub; save: (next: AdminHub) => Promise<void>; onCatalog: (next: PremiumCatalog) => void }): React.JSX.Element {
  if (!catalog) return <p className="form-help">Loading videos…</p>
  return (
    <div className="settings-card">
      <div className="setting-row"><span><strong>Total Videos</strong></span><strong>{catalog.media.filter((item) => item.type === 'video').length}</strong></div>
      {catalog.media.map((item) => {
        const hidden = hub.hiddenVideos.includes(item.id)
        return (
          <div className="setting-row" key={item.id} style={{ flexWrap: 'wrap' }}>
            <span><strong>{item.title}</strong><small>{item.type}{hidden ? ' · hidden' : ''}</small></span>
            <button className="text-button" type="button" onClick={() => void save({
              ...hub,
              hiddenVideos: hidden ? hub.hiddenVideos.filter((id) => id !== item.id) : [...hub.hiddenVideos, item.id]
            })}>{hidden ? 'Unhide' : 'Hide'}</button>
            <button className="text-button" type="button" onClick={async () => {
              if (!window.confirm('Delete this video?')) return
              const result = await premiumAdmin('deleteMedia', { id: item.id })
              if (result.ok && result.catalog) onCatalog(result.catalog)
            }}>Delete</button>
          </div>
        )
      })}
    </div>
  )
}

// ** Payment QR tab **
function QrTab({ hub, save }: { hub: AdminHub; save: (next: AdminHub) => Promise<void> }): React.JSX.Element {
  const [qr, setQr] = useState(hub.qr)
  const [saving, setSaving] = useState(false)
  useEffect(() => setQr(hub.qr), [hub])
  const dirty = qr !== hub.qr
  const choose = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setQr(await fileToDataUrl(file))
    event.target.value = ''
  }
  return (
    <div className="premium-post-form settings-card" style={{ padding: 14 }}>
      <h3>Payment QR Code</h3>
      <p className="form-help">The QR that opens in the payment popup on the login page when a user picks Premium ⭐ / VIP 💎. Pick an image below, preview it, then Save.</p>
      <div className="qr-preview">
        {qr
          ? <img src={qr} alt="Payment QR preview" />
          : <p className="form-help">No QR yet — choose an image below.</p>}
      </div>
      <label className="primary-button primary-button--wide">
        {qr ? 'Replace QR image' : 'Choose QR image'}
        <input className="sr-only" type="file" accept="image/*" onChange={(event) => void choose(event)} />
      </label>
      {qr && <button className="secondary-button" type="button" onClick={() => setQr('')}>Remove image</button>}
      <SaveBar dirty={dirty} saving={saving} onSave={async () => { setSaving(true); await save({ ...hub, qr }); setSaving(false) }} onUndo={() => setQr(hub.qr)} />
      <p className="form-help">Save changes → the login page payment popup updates instantly.</p>
    </div>
  )
}

// ** Premium ⭐ / VIP 💎 plans tab **
function PlansTab({ hub, save }: { hub: AdminHub; save: (next: AdminHub) => Promise<void> }): React.JSX.Element {
  const [draft, setDraft] = useState({ premium: hub.plans.premium, vip: hub.plans.vip })
  const [saving, setSaving] = useState(false)
  useEffect(() => setDraft({ premium: hub.plans.premium, vip: hub.plans.vip }), [hub])
  const dirty = !eq(draft, { premium: hub.plans.premium, vip: hub.plans.vip })
  return (
    <div className="premium-post-form">
      <h3>Premium ⭐</h3>
      <p className="form-help">Shown as a card on the login page. Hidden (toggle off) cards are not offered.</p>
      <PlanFields plan={draft.premium} onChange={(premium) => setDraft({ ...draft, premium })} />
      <h3>VIP 💎</h3>
      <PlanFields plan={draft.vip} onChange={(vip) => setDraft({ ...draft, vip })} />
      <SaveBar dirty={dirty} saving={saving} onSave={async () => { setSaving(true); await save({ ...hub, plans: draft }); setSaving(false) }} onUndo={() => setDraft({ premium: hub.plans.premium, vip: hub.plans.vip })} />
      <p className="form-help">Save changes → the login page plan cards update instantly.</p>
    </div>
  )
}

function PlanFields({ plan, onChange }: { plan: PlanInfo; onChange: (plan: PlanInfo) => void }): React.JSX.Element {
  return (
    <>
      <input value={plan.name} onChange={(event) => onChange({ ...plan, name: event.target.value })} placeholder="Plan name" />
      <input value={plan.price} onChange={(event) => onChange({ ...plan, price: event.target.value })} placeholder="Price (e.g. ₹499 / month)" />
      <textarea value={plan.description} onChange={(event) => onChange({ ...plan, description: event.target.value })} placeholder="Description" />
      <label className="setting-row"><span><strong>Show on login page</strong></span><input className="switch" type="checkbox" checked={plan.enabled} onChange={(event) => onChange({ ...plan, enabled: event.target.checked })} /></label>
    </>
  )
}

// ** Home banner (card) tab **
function HomeCardTab({ hub, save }: { hub: AdminHub; save: (next: AdminHub) => Promise<void> }): React.JSX.Element {
  const [draft, setDraft] = useState<HomeCardConfig>(hub.homeCard)
  const [saving, setSaving] = useState(false)
  useEffect(() => setDraft(hub.homeCard), [hub])
  const dirty = !eq(draft, hub.homeCard)
  const set = (patch: Partial<HomeCardConfig>) => setDraft({ ...draft, ...patch })
  const chooseImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    set({ image: await fileToDataUrl(file) })
    event.target.value = ''
  }
  return (
    <div className="premium-post-form">
      <h3>Home Banner</h3>
      <p className="form-help">The hero card at the top of the home page. Preview updates live below as you type.</p>
      <label className="admin-field"><span>Label</span><input value={draft.label} onChange={(event) => set({ label: event.target.value })} placeholder="Small label" /></label>
      <label className="admin-field"><span>Title</span><input value={draft.title} onChange={(event) => set({ title: event.target.value })} placeholder="Main title" /></label>
      <label className="admin-field"><span>Description</span><textarea value={draft.description} onChange={(event) => set({ description: event.target.value })} placeholder="Description" /></label>
      <label className="admin-field"><span>Online / status text</span><input value={draft.online} onChange={(event) => set({ online: event.target.value })} placeholder="e.g. 128 online (optional)" /></label>
      <label className="admin-field"><span>Button text</span><input value={draft.buttonText} onChange={(event) => set({ buttonText: event.target.value })} placeholder="Button text (optional)" /></label>
      <label className="admin-field"><span>Button link</span><input value={draft.buttonUrl} onChange={(event) => set({ buttonUrl: event.target.value })} placeholder="#/you or https://… (optional)" /></label>

      <div className="banner-image-row">
        {draft.image && <img className="banner-thumb" src={draft.image} alt="Banner preview" />}
        <label className="primary-button">{draft.image ? 'Replace banner image' : 'Choose banner image'}<input className="sr-only" type="file" accept="image/*" onChange={(event) => void chooseImage(event)} /></label>
        {draft.image && <button className="secondary-button" type="button" onClick={() => set({ image: '' })}>Remove</button>}
      </div>

      <label className="setting-row"><span><strong>Show banner on home page</strong></span><input className="switch" type="checkbox" checked={draft.enabled} onChange={(event) => set({ enabled: event.target.checked })} /></label>

      <p className="eyebrow" style={{ marginTop: 14 }}>Live preview</p>
      <div className="home-intro" style={draft.image ? { backgroundImage: `linear-gradient(180deg, rgba(8,6,6,.25), rgba(8,6,6,.78)), url(${draft.image})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
        <div>
          <p className="home-intro__kicker">{draft.label}</p>
          <h2>{draft.title}</h2>
          <p>{draft.description}</p>
          {draft.buttonText && <button className="primary-button" type="button" style={{ marginTop: 14 }}>{draft.buttonText}</button>}
        </div>
        <div className="home-intro__pills">
          {draft.online ? <span className="online-pill"><i />{draft.online}</span> : null}
          <span className="live-pill"><i /> Live V2</span>
        </div>
      </div>

      <SaveBar dirty={dirty} saving={saving} onSave={async () => { setSaving(true); await save({ ...hub, homeCard: draft }); setSaving(false) }} onUndo={() => setDraft(hub.homeCard)} />
      <p className="form-help">Save changes → the home page banner updates instantly.</p>
    </div>
  )
}

// ** Notifications tab **
function NotificationsTab({ hub, save }: { hub: AdminHub; save: (next: AdminHub) => Promise<void> }): React.JSX.Element {
  const { notify } = useApp()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [link, setLink] = useState('')
  const [sending, setSending] = useState(false)

  const valid = title.trim().length > 0 && message.trim().length > 0

  const send = async () => {
    if (!valid || sending) return
    setSending(true)
    const item: HubNotification = {
      id: `nt-${Date.now()}`,
      title: title.trim(),
      message: message.trim(),
      link: link.trim(),
      buttonText: 'View',
      active: true,
      createdAt: new Date().toISOString()
    }
    await save({ ...hub, notifications: [item, ...hub.notifications] })
    setTitle('')
    setMessage('')
    setLink('')
    setSending(false)
    notify('Notification sent to all users 🔔', 'success')
  }

  const toggleActive = async (id: string) => {
    await save({ ...hub, notifications: hub.notifications.map((entry) => entry.id === id ? { ...entry, active: !entry.active } : entry) })
  }
  const remove = async (id: string) => {
    await save({ ...hub, notifications: hub.notifications.filter((entry) => entry.id !== id) })
  }

  return (
    <div className="premium-post-form">
      <h3>🔔 Send Notification to All Users</h3>
      <p className="form-help">Appears in the bell on the home screen for everyone the moment you Save.</p>
      <label className="admin-field"><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Notification title" /></label>
      <label className="admin-field"><span>Description</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Notification message" /></label>
      <label className="admin-field"><span>Link (optional)</span><input value={link} onChange={(event) => setLink(event.target.value)} placeholder="#/you or https://…" /></label>
      <SaveBar dirty={valid} saving={sending} busy={sending} onSave={() => void send()} onUndo={() => { setTitle(''); setMessage(''); setLink('') }} />

      <h3 style={{ marginTop: '18px' }}>📋 Sent notifications</h3>
      {hub.notifications.length === 0 ? (
        <p className="form-help">Nothing sent yet.</p>
      ) : hub.notifications.map((item) => (
        <div className="settings-card" key={item.id} style={{ marginBottom: 10, padding: 12 }}>
          <div className="setting-row" style={{ minHeight: 0, padding: 0 }}>
            <span><strong>{item.title} {!item.active && <em className="muted-em">(hidden)</em>}</strong><small>{item.message}</small></span>
          </div>
          {item.link && <p className="form-help" style={{ wordBreak: 'break-all' }}>🔗 {item.link}</p>}
          <div className="home-header-actions" style={{ marginTop: 8 }}>
            <button className="text-button" type="button" onClick={() => void toggleActive(item.id)}>{item.active ? 'Hide' : 'Show'}</button>
            <button className="text-button" type="button" onClick={() => void remove(item.id)}><TrashIcon size={15} /> Delete</button>
            <span className="form-help" style={{ marginLeft: 'auto' }}>{new Date(item.createdAt).toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
