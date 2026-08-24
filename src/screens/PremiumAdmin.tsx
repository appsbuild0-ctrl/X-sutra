import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  fetchPremiumCatalog,
  importInBatches,
  premiumAdmin,
  scanPremiumPages,
  type PremiumCatalog,
  type ScanItem,
  type ScanPage
} from '../lib/premium'

type AdminView = 'settings' | 'channels' | 'albums' | 'upload' | 'import'

const SETTING_ROWS: Array<{ key: keyof PremiumCatalog['settings']; label: string }> = [
  { key: 'premiumUpload', label: 'Premium Upload' },
  { key: 'urlImport', label: 'URL Import' },
  { key: 'imageUpload', label: 'Image Upload' },
  { key: 'videoUpload', label: 'Video Upload' },
  { key: 'fileUpload', label: 'File Upload' },
  { key: 'albumCreation', label: 'Album Creation' },
  { key: 'channelCreation', label: 'Channel Creation' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'newVideoNotifications', label: 'New Video Notifications' }
]

export function PremiumAdmin(): React.JSX.Element {
  const { notify } = useApp()
  const [view, setView] = useState<AdminView>('import')
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = async () => setCatalog(await fetchPremiumCatalog())
  useEffect(() => { void reload() }, [])

  if (!catalog) return <p className="form-help">Loading premium management…</p>

  return (
    <div className="premium-admin">
      <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Premium</p><h3>Premium management</h3></div></div>
      <div className="premium-admin__nav">
        {([['import', 'Bulk import'], ['upload', 'Upload URL'], ['channels', 'Channels'], ['albums', 'Albums'], ['settings', 'Settings']] as const).map(([id, label]) => (
          <button key={id} className={view === id ? 'is-active' : ''} type="button" onClick={() => setView(id)}>{label}</button>
        ))}
      </div>
      {view === 'settings' && <SettingsPane catalog={catalog} setCatalog={setCatalog} notify={notify} busy={busy} setBusy={setBusy} />}
      {view === 'channels' && <ChannelsPane catalog={catalog} setCatalog={setCatalog} notify={notify} />}
      {view === 'albums' && <AlbumsPane catalog={catalog} setCatalog={setCatalog} notify={notify} />}
      {view === 'upload' && <UploadPane catalog={catalog} setCatalog={setCatalog} notify={notify} />}
      {view === 'import' && <ImportPane catalog={catalog} setCatalog={setCatalog} notify={notify} />}
    </div>
  )
}

function SettingsPane({ catalog, setCatalog, notify, busy, setBusy }: { catalog: PremiumCatalog; setCatalog: (catalog: PremiumCatalog) => void; notify: (text: string, tone?: 'success' | 'error') => void; busy: boolean; setBusy: (value: boolean) => void }): React.JSX.Element {
  const toggle = async (key: keyof PremiumCatalog['settings']) => {
    if (busy) return
    setBusy(true)
    const settings = { ...catalog.settings, [key]: !catalog.settings[key] }
    const result = await premiumAdmin('updateSettings', { settings })
    if (result.ok && result.catalog) {
      setCatalog(result.catalog)
      notify(`${SETTING_ROWS.find((row) => row.key === key)?.label} ${settings[key] ? 'on' : 'off'}`, 'success')
    } else notify(result.error ?? 'Could not save setting', 'error')
    setBusy(false)
  }
  return (
    <div className="settings-card">
      {SETTING_ROWS.map((row) => (
        <label className="setting-row" key={row.key}>
          <span><strong>{row.label}</strong><small>Controls the real Premium {row.label.toLowerCase()} feature</small></span>
          <input className="switch" type="checkbox" checked={catalog.settings[row.key]} onChange={() => void toggle(row.key)} />
        </label>
      ))}
    </div>
  )
}

function ChannelsPane({ catalog, setCatalog, notify }: { catalog: PremiumCatalog; setCatalog: (catalog: PremiumCatalog) => void; notify: (text: string, tone?: 'success' | 'error' | 'default') => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [cover, setCover] = useState('')
  const [type, setType] = useState<'images' | 'videos' | 'mixed'>('mixed')
  const [order, setOrder] = useState('1')
  if (!catalog.settings.channelCreation) return <p className="form-help">Channel creation is turned off in Premium settings.</p>
  return (
    <div className="premium-post-form">
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Channel name" />
      <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
      <input value={cover} onChange={(event) => setCover(event.target.value)} placeholder="Cover image URL (optional)" />
      <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
        <option value="mixed">Mixed</option>
        <option value="images">Images</option>
        <option value="videos">Videos</option>
      </select>
      <input value={order} onChange={(event) => setOrder(event.target.value)} placeholder="Order" inputMode="numeric" />
      <button className="primary-button" type="button" onClick={async () => {
        const result = await premiumAdmin('createChannel', { name, description, cover, type, order: Number(order) || 1, status: 'on' })
        if (result.ok && result.catalog) { setCatalog(result.catalog); setName(''); setDescription(''); notify('Channel created', 'success') }
        else notify(result.error ?? 'Failed', 'error')
      }}>+ Create channel</button>
      <div className="quick-link-list">
        {catalog.channels.map((channel) => (
          <div className="premium-admin-row" key={channel.id}>
            <strong>{channel.name}</strong>
            <small>{channel.type} · {channel.status}</small>
            <button type="button" className="text-button" onClick={async () => {
              const result = await premiumAdmin('updateChannel', { id: channel.id, status: channel.status === 'on' ? 'off' : 'on' })
              if (result.ok && result.catalog) setCatalog(result.catalog)
            }}>{channel.status === 'on' ? 'Turn off' : 'Turn on'}</button>
            <button type="button" className="text-button" onClick={async () => {
              const result = await premiumAdmin('deleteChannel', { id: channel.id })
              if (result.ok && result.catalog) setCatalog(result.catalog)
            }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function AlbumsPane({ catalog, setCatalog, notify }: { catalog: PremiumCatalog; setCatalog: (catalog: PremiumCatalog) => void; notify: (text: string, tone?: 'success' | 'error' | 'default') => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [cover, setCover] = useState('')
  const [channelId, setChannelId] = useState(catalog.channels[0]?.id ?? '')
  if (!catalog.settings.albumCreation) return <p className="form-help">Album creation is turned off.</p>
  return (
    <div className="premium-post-form">
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Album name" />
      <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description / searchable text" rows={3} />
      <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags (comma separated)" />
      <input value={cover} onChange={(event) => setCover(event.target.value)} placeholder="Cover image URL" />
      <select value={channelId} onChange={(event) => setChannelId(event.target.value)}>
        <option value="">No channel</option>
        {catalog.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
      </select>
      <button className="primary-button" type="button" onClick={async () => {
        const result = await premiumAdmin('createAlbum', { name, description, tags, cover, channelId, published: true })
        if (result.ok && result.catalog) { setCatalog(result.catalog); setName(''); setDescription(''); notify('Album created', 'success') }
        else notify(result.error ?? 'Failed', 'error')
      }}>+ Create album</button>
      {catalog.albums.map((album) => (
        <div className="premium-admin-row" key={album.id}>
          <strong>{album.name}</strong>
          <small>{album.description}</small>
          <button type="button" className="text-button" onClick={async () => {
            const result = await premiumAdmin('deleteAlbum', { id: album.id })
            if (result.ok && result.catalog) setCatalog(result.catalog)
          }}>Delete</button>
        </div>
      ))}
    </div>
  )
}

function UploadPane({ catalog, setCatalog, notify }: { catalog: PremiumCatalog; setCatalog: (catalog: PremiumCatalog) => void; notify: (text: string, tone?: 'success' | 'error' | 'default') => void }): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [pages, setPages] = useState<ScanPage[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [channelId, setChannelId] = useState(catalog.channels[0]?.id ?? '')
  const [albumId, setAlbumId] = useState(catalog.albums[0]?.id ?? '')
  const items = useMemo(() => pages.flatMap((page) => [...page.images, ...page.videos]), [pages])
  if (!catalog.settings.premiumUpload || !catalog.settings.urlImport) return <p className="form-help">URL import is turned off.</p>
  return (
    <div className="premium-post-form">
      <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste authorized webpage or media URL" />
      <button className="primary-button" type="button" onClick={async () => {
        const result = await scanPremiumPages(url)
        if (!result.ok) return notify(result.error ?? 'Scan failed', 'error')
        setPages(result.pages ?? [])
        const next: Record<string, boolean> = {}
        for (const item of (result.pages ?? []).flatMap((page) => [...page.images, ...page.videos])) next[item.url] = true
        setSelected(next)
        notify(`Found ${(result.totals?.media ?? 0)} media`, 'success')
      }}>Scan</button>
      <ScanResults pages={pages} selected={selected} setSelected={setSelected} items={items} />
      <ImportTargets catalog={catalog} channelId={channelId} setChannelId={setChannelId} albumId={albumId} setAlbumId={setAlbumId} setCatalog={setCatalog} />
      <ImportButton items={items.filter((item) => selected[item.url])} catalog={catalog} channelId={channelId} albumId={albumId} setCatalog={setCatalog} notify={notify} />
    </div>
  )
}

function ImportPane({ catalog, setCatalog, notify }: { catalog: PremiumCatalog; setCatalog: (catalog: PremiumCatalog) => void; notify: (text: string, tone?: 'success' | 'error' | 'default') => void }): React.JSX.Element {
  const [urls, setUrls] = useState('')
  const [pages, setPages] = useState<ScanPage[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [channelId, setChannelId] = useState(catalog.channels[0]?.id ?? '')
  const [albumId, setAlbumId] = useState(catalog.albums[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [dupes, setDupes] = useState(false)
  const [newAlbum, setNewAlbum] = useState('')
  const items = useMemo(() => pages.flatMap((page) => [...page.images, ...page.videos]), [pages])
  if (!catalog.settings.premiumUpload || !catalog.settings.urlImport) return <p className="form-help">Bulk import is turned off.</p>
  return (
    <div className="premium-post-form">
      <textarea className="premium-import-urls" value={urls} onChange={(event) => setUrls(event.target.value)} placeholder={'Paste webpage URLs:\nhttps://example.com/page-1\nhttps://example.com/page-2'} rows={7} />
      <button className="primary-button primary-button--wide" type="button" onClick={async () => {
        const result = await scanPremiumPages(urls)
        if (!result.ok) return notify(result.error ?? 'Scan failed', 'error')
        setPages(result.pages ?? [])
        const next: Record<string, boolean> = {}
        for (const item of (result.pages ?? []).flatMap((page) => [...page.images, ...page.videos])) next[item.url] = true
        setSelected(next)
        notify(`Scan complete · ${result.totals?.images ?? 0} images · ${result.totals?.videos ?? 0} videos`, 'success')
      }}>Scan all</button>
      {pages.length > 0 && (
        <div className="premium-scan-summary">
          {pages.map((page) => (
            <p key={page.url}><strong>{page.url}</strong><br />{page.error ? page.error : `Images: ${page.images.length} · Videos: ${page.videos.length}`}</p>
          ))}
          <strong>Total media: {items.length}</strong>
        </div>
      )}
      <ScanResults pages={pages} selected={selected} setSelected={setSelected} items={items} />
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional title for imported items" />
      <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags" />
      <label className="setting-row"><span><strong>Import duplicates</strong></span><input className="switch" type="checkbox" checked={dupes} onChange={(event) => setDupes(event.target.checked)} /></label>
      <ImportTargets catalog={catalog} channelId={channelId} setChannelId={setChannelId} albumId={albumId} setAlbumId={setAlbumId} setCatalog={setCatalog} newAlbum={newAlbum} setNewAlbum={setNewAlbum} />
      <ImportButton items={items.filter((item) => selected[item.url])} catalog={catalog} channelId={channelId} albumId={albumId} setCatalog={setCatalog} notify={notify} title={title} tags={tags} importDuplicates={dupes} />
    </div>
  )
}

function ImportTargets({ catalog, channelId, setChannelId, albumId, setAlbumId, setCatalog, newAlbum, setNewAlbum }: {
  catalog: PremiumCatalog
  channelId: string
  setChannelId: (value: string) => void
  albumId: string
  setAlbumId: (value: string) => void
  setCatalog: (catalog: PremiumCatalog) => void
  newAlbum?: string
  setNewAlbum?: (value: string) => void
}): React.JSX.Element {
  return (
    <>
      <select value={channelId} onChange={(event) => setChannelId(event.target.value)}>
        <option value="">Select channel</option>
        {catalog.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
      </select>
      <select value={albumId} onChange={(event) => setAlbumId(event.target.value)}>
        <option value="">Select album</option>
        {catalog.albums.filter((album) => !channelId || album.channelId === channelId || !album.channelId).map((album) => <option key={album.id} value={album.id}>{album.name}</option>)}
      </select>
      {setNewAlbum && (
        <div className="collection-form">
          <input value={newAlbum} onChange={(event) => setNewAlbum(event.target.value)} placeholder="Or create a new album" />
          <button className="secondary-button" type="button" onClick={async () => {
            if (!newAlbum?.trim()) return
            const result = await premiumAdmin('createAlbum', { name: newAlbum, description: '', tags: '', channelId, published: true })
            if (result.ok && result.catalog) {
              setCatalog(result.catalog)
              const created = result.catalog.albums.find((album) => album.name === newAlbum.trim())
              if (created) setAlbumId(created.id)
              setNewAlbum('')
            }
          }}>+ Album</button>
        </div>
      )}
    </>
  )
}

function ScanResults({ pages, selected, setSelected, items }: { pages: ScanPage[]; selected: Record<string, boolean>; setSelected: (value: Record<string, boolean>) => void; items: ScanItem[] }): React.JSX.Element | null {
  if (!items.length) return pages.length ? <p className="form-help">No supported media found on these pages.</p> : null
  return (
    <>
      <div className="guest-card__actions">
        <button className="secondary-button" type="button" onClick={() => setSelected(Object.fromEntries(items.map((item) => [item.url, true])))}>Select all</button>
        <button className="secondary-button" type="button" onClick={() => setSelected({})}>Deselect all</button>
      </div>
      <div className="premium-scan-grid">
        {items.map((item) => (
          <label key={item.url} className={`premium-scan-item${selected[item.url] ? ' is-on' : ''}`}>
            <input type="checkbox" checked={Boolean(selected[item.url])} onChange={(event) => setSelected({ ...selected, [item.url]: event.target.checked })} />
            <span className="premium-scan-item__thumb" style={item.thumbnail ? { backgroundImage: `url(${item.thumbnail})` } : undefined} />
            <small>{item.type} · {item.filename}</small>
          </label>
        ))}
      </div>
    </>
  )
}

function ImportButton({ items, catalog, channelId, albumId, setCatalog, notify, title = '', tags = '', importDuplicates = false }: {
  items: ScanItem[]
  catalog: PremiumCatalog
  channelId: string
  albumId: string
  setCatalog: (catalog: PremiumCatalog) => void
  notify: (text: string, tone?: 'success' | 'error' | 'default') => void
  title?: string
  tags?: string
  importDuplicates?: boolean
}): React.JSX.Element {
  const [progress, setProgress] = useState<{ done: number; total: number; added: number; skipped: number; failed: number } | null>(null)
  const [failed, setFailed] = useState<ScanItem[]>([])
  const run = async (queue: ScanItem[]) => {
    if (!channelId || !albumId) {
      notify('Select a channel and album first', 'error')
      return
    }
    const result = await importInBatches(queue, { channelId, albumId, title, tags, importDuplicates }, (done, total, added, skipped, failedCount) => {
      setProgress({ done, total, added, skipped, failed: failedCount })
    })
    setFailed(result.failed)
    setCatalog(await fetchPremiumCatalog())
    notify(`Imported ${result.added} · skipped ${result.skipped} · failed ${result.failed.length}`, result.failed.length ? 'error' : 'success')
  }
  return (
    <>
      <button className="primary-button primary-button--wide" type="button" disabled={!items.length} onClick={() => void run(items)}>
        Import selected media ({items.length})
      </button>
      {progress && (
        <div className="premium-progress">
          <p>Importing {progress.total} media… {progress.done}/{progress.total}</p>
          <i style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }} />
          <small>Successful: {progress.added} · Skipped: {progress.skipped} · Failed: {progress.failed} · Remaining: {Math.max(progress.total - progress.done, 0)}</small>
        </div>
      )}
      {failed.length > 0 && <button className="secondary-button" type="button" onClick={() => void run(failed)}>Retry failed ({failed.length})</button>}
    </>
  )
}
