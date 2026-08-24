import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  fetchPremiumCatalog,
  hashFile,
  premiumAdmin,
  uploadPremiumFile,
  type PremiumCatalog
} from '../lib/premium'

type AdminView = 'upload' | 'channels' | 'settings'
type UploadKind = 'hero' | 'image' | 'video' | 'album'
type QueueStatus = 'waiting' | 'uploading' | 'done' | 'failed' | 'skipped'

interface QueueItem {
  file: File
  preview: string
  status: QueueStatus
  error?: string
}

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
  const [view, setView] = useState<AdminView>('upload')
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)

  useEffect(() => { void fetchPremiumCatalog().then(setCatalog) }, [])
  if (!catalog) return <p className="form-help">Loading premium management…</p>

  return (
    <div className="premium-admin">
      <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Premium</p><h3>Premium management</h3></div></div>
      <div className="premium-admin__nav">
        <button className={view === 'upload' ? 'is-active' : ''} type="button" onClick={() => setView('upload')}>+ Upload</button>
        <button className={view === 'channels' ? 'is-active' : ''} type="button" onClick={() => setView('channels')}>Channels</button>
        <button className={view === 'settings' ? 'is-active' : ''} type="button" onClick={() => setView('settings')}>Settings</button>
      </div>
      {view === 'upload' && <UploadAllPanel catalog={catalog} setCatalog={setCatalog} notify={notify} />}
      {view === 'channels' && <ChannelsPane catalog={catalog} setCatalog={setCatalog} notify={notify} />}
      {view === 'settings' && <SettingsPane catalog={catalog} setCatalog={setCatalog} notify={notify} />}
    </div>
  )
}

function UploadAllPanel({ catalog, setCatalog, notify }: { catalog: PremiumCatalog; setCatalog: (catalog: PremiumCatalog) => void; notify: (text: string, tone?: 'success' | 'error') => void }): React.JSX.Element {
  const [kind, setKind] = useState<UploadKind>('image')
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [autoChannel, setAutoChannel] = useState(true)
  const [autoCategory, setAutoCategory] = useState(true)
  const [autoAlbum, setAutoAlbum] = useState(true)
  const [allowDupes, setAllowDupes] = useState(false)
  const [running, setRunning] = useState(false)
  const [directUrl, setDirectUrl] = useState('')

  if (!catalog.settings.premiumUpload) return <p className="form-help">Premium upload is turned off.</p>

  const pick = (files: FileList | null) => {
    const next = [...(files ?? [])].filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
    setQueue(next.map((file) => ({ file, preview: URL.createObjectURL(file), status: 'waiting' })))
  }

  const ensureTargets = async (current: PremiumCatalog): Promise<{ catalog: PremiumCatalog; channelId: string; albumId: string }> => {
    let next = current
    let channelId = ''
    let albumId = ''
    if (autoChannel || autoCategory) {
      const name = autoCategory && autoChannel ? 'Premium' : autoCategory ? 'Category' : 'Premium'
      let channel = next.channels.find((entry) => entry.status !== 'off') ?? next.channels[0]
      if (!channel) {
        const result = await premiumAdmin('createChannel', { name, type: 'mixed', status: 'on', order: 1 })
        if (result.ok && result.catalog) {
          next = result.catalog
          channel = next.channels.find((entry) => entry.name === name) ?? next.channels[0]
        }
      }
      channelId = channel?.id ?? ''
    }
    if (autoAlbum) {
      let album = next.albums.find((entry) => entry.published !== false && (!channelId || entry.channelId === channelId || !entry.channelId))
      if (!album) {
        const result = await premiumAdmin('createAlbum', { name: 'Uploads', description: '', tags: '', channelId, published: true })
        if (result.ok && result.catalog) {
          next = result.catalog
          album = next.albums.find((entry) => entry.name === 'Uploads') ?? next.albums[0]
        }
      }
      albumId = album?.id ?? ''
    }
    setCatalog(next)
    return { catalog: next, channelId, albumId }
  }

  const uploadQueue = async (onlyFailed = false) => {
    setRunning(true)
    const targets = kind === 'hero' ? { catalog, channelId: '', albumId: '' } : await ensureTargets(catalog)
    const items = queue.map((item, index) => ({ item, index })).filter(({ item }) => onlyFailed ? item.status === 'failed' : item.status === 'waiting' || item.status === 'failed')
    let done = 0
    for (const { item, index } of items) {
      setQueue((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, status: 'uploading' } : entry))
      const isVideo = item.file.type.startsWith('video/')
      if ((isVideo && !catalog.settings.videoUpload) || (!isVideo && !catalog.settings.imageUpload)) {
        setQueue((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, status: 'failed', error: 'This media type is turned off' } : entry))
        continue
      }
      const hash = await hashFile(item.file)
      if (!allowDupes && targets.catalog.media.some((entry) => entry.hash === hash || entry.filename === item.file.name && entry.size === item.file.size)) {
        setQueue((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, status: 'skipped' } : entry))
        done += 1
        continue
      }
      const uploaded = await uploadPremiumFile(item.file)
      if (!uploaded.ok || !uploaded.url) {
        setQueue((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, status: 'failed', error: uploaded.error } : entry))
        continue
      }
      const result = await premiumAdmin('importMedia', {
        items: [{
          url: uploaded.url,
          type: isVideo ? 'video' : 'image',
          filename: item.file.name,
          thumbnail: isVideo ? '' : uploaded.url,
          title: item.file.name,
          hash,
          size: item.file.size,
          role: kind === 'hero' ? 'hero' : 'content'
        }],
        channelId: targets.channelId,
        albumId: targets.albumId,
        importDuplicates: allowDupes
      })
      setQueue((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, status: result.ok ? 'done' : 'failed', error: result.error } : entry))
      if (result.ok && result.catalog) setCatalog(result.catalog)
      done += 1
    }
    setRunning(false)
    notify(`Upload finished · ${done} processed`, 'success')
  }

  const counts = {
    done: queue.filter((item) => item.status === 'done').length,
    uploading: queue.filter((item) => item.status === 'uploading').length,
    waiting: queue.filter((item) => item.status === 'waiting').length,
    failed: queue.filter((item) => item.status === 'failed').length,
    skipped: queue.filter((item) => item.status === 'skipped').length
  }

  return (
    <div className="premium-post-form">
      <strong>Premium upload</strong>
      <label className="primary-button primary-button--wide">
        Select multiple files
        <input className="sr-only" type="file" accept="image/*,video/*" multiple onChange={(event) => pick(event.target.files)} />
      </label>
      <input value={directUrl} onChange={(event) => setDirectUrl(event.target.value)} placeholder="Or paste image/video URL (https://...)" inputMode="url" />
      <button className="secondary-button" type="button" onClick={async () => {
        const url = directUrl.trim()
        if (!/^https?:\/\//i.test(url)) return notify('Valid https URL chahiye', 'error')
        const targets = kind === 'hero' ? { catalog, channelId: '', albumId: '' } : await ensureTargets(catalog)
        const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) || kind === 'video'
        const result = await premiumAdmin('importMedia', {
          items: [{ url, type: isVideo ? 'video' : 'image', filename: url, thumbnail: isVideo ? '' : url, title: 'Premium media', role: kind === 'hero' ? 'hero' : 'content' }],
          channelId: targets.channelId,
          albumId: targets.albumId
        })
        if (result.ok && result.catalog) { setCatalog(result.catalog); setDirectUrl(''); notify('URL published to Premium', 'success') }
        else notify(result.error ?? 'URL publish fail', 'error')
      }}>Publish URL</button>
      {queue.length > 0 && (
        <div className="premium-scan-grid">
          {queue.map((item) => (
            <div key={item.file.name + item.file.size} className="premium-scan-item">
              <span className="premium-scan-item__thumb" style={item.file.type.startsWith('image/') ? { backgroundImage: `url(${item.preview})` } : undefined} />
              <small>{item.file.name}</small>
              <small>{item.status}{item.error ? ` · ${item.error}` : ''}</small>
            </div>
          ))}
        </div>
      )}
      <div className="premium-kind-row">
        {(['hero', 'image', 'video', 'album'] as const).map((value) => (
          <button key={value} className={kind === value ? 'is-active' : ''} type="button" onClick={() => setKind(value)}>{value === 'hero' ? 'Poster / Hero' : value}</button>
        ))}
      </div>
      <div className="settings-card">
        <label className="setting-row"><span><strong>Create channel</strong><small>ON = upload pe Premium channel apne aap</small></span><input className="switch" type="checkbox" checked={autoChannel} onChange={(event) => setAutoChannel(event.target.checked)} /></label>
        <label className="setting-row"><span><strong>Create category</strong><small>ON = category Home pe apne aap</small></span><input className="switch" type="checkbox" checked={autoCategory} onChange={(event) => setAutoCategory(event.target.checked)} /></label>
        <label className="setting-row"><span><strong>Albums</strong><small>ON = Uploads album apne aap</small></span><input className="switch" type="checkbox" checked={autoAlbum} onChange={(event) => setAutoAlbum(event.target.checked)} /></label>
        <label className="setting-row"><span><strong>Upload duplicates</strong></span><input className="switch" type="checkbox" checked={allowDupes} onChange={(event) => setAllowDupes(event.target.checked)} /></label>
      </div>
      {catalog.channels.length > 0 && (
        <div className="settings-card">
          {catalog.channels.map((channel) => (
            <label className="setting-row" key={channel.id}>
              <span><strong>{channel.name}</strong><small>Category / channel</small></span>
              <input className="switch" type="checkbox" checked={channel.status !== 'off'} onChange={async () => {
                const result = await premiumAdmin('updateChannel', { id: channel.id, status: channel.status === 'on' ? 'off' : 'on' })
                if (result.ok && result.catalog) setCatalog(result.catalog)
              }} />
            </label>
          ))}
          {catalog.albums.map((album) => (
            <label className="setting-row" key={album.id}>
              <span><strong>{album.name}</strong><small>Album</small></span>
              <input className="switch" type="checkbox" checked={album.published !== false} onChange={async () => {
                const result = await premiumAdmin('updateAlbum', { id: album.id, published: album.published === false })
                if (result.ok && result.catalog) setCatalog(result.catalog)
              }} />
            </label>
          ))}
        </div>
      )}
      <button className="primary-button primary-button--wide" type="button" disabled={running || !queue.length} onClick={() => void uploadQueue(false)}>
        {running ? 'Uploading…' : `Upload all (${queue.length})`}
      </button>
      {queue.length > 0 && (
        <div className="premium-progress">
          <p>Uploading {queue.length} files · {Math.round(((counts.done + counts.skipped) / Math.max(queue.length, 1)) * 100)}%</p>
          <i style={{ width: `${Math.round(((counts.done + counts.skipped) / Math.max(queue.length, 1)) * 100)}%` }} />
          <small>Completed: {counts.done} · Uploading: {counts.uploading} · Waiting: {counts.waiting} · Failed: {counts.failed} · Skipped: {counts.skipped}</small>
        </div>
      )}
      {counts.failed > 0 && <button className="secondary-button" type="button" onClick={() => void uploadQueue(true)}>Retry failed ({counts.failed})</button>}
    </div>
  )
}

function ChannelsPane({ catalog, setCatalog, notify }: { catalog: PremiumCatalog; setCatalog: (catalog: PremiumCatalog) => void; notify: (text: string, tone?: 'success' | 'error') => void }): React.JSX.Element {
  const [name, setName] = useState('')
  return (
    <div className="premium-post-form">
      <div className="collection-form">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="New channel name" />
        <button className="secondary-button" type="button" onClick={async () => {
          if (!name.trim()) return
          const result = await premiumAdmin('createChannel', { name: name.trim(), type: 'mixed', status: 'on', order: catalog.channels.length + 1 })
          if (result.ok && result.catalog) { setCatalog(result.catalog); setName(''); notify('Channel created', 'success') }
          else notify(result.error ?? 'Failed', 'error')
        }}>+ Create</button>
      </div>
      {!catalog.channels.length && <p className="form-help">No channels yet.</p>}
      {catalog.channels.map((channel) => (
        <div className="premium-admin-row" key={channel.id}>
          <strong>{channel.name}</strong>
          <small>{channel.status}</small>
          <button type="button" className="text-button" onClick={async () => {
            const result = await premiumAdmin('updateChannel', { id: channel.id, status: channel.status === 'on' ? 'off' : 'on' })
            if (result.ok && result.catalog) setCatalog(result.catalog)
          }}>{channel.status === 'on' ? 'Disable' : 'Enable'}</button>
          <button type="button" className="text-button" onClick={async () => {
            const name = window.prompt('Rename channel', channel.name)
            if (!name) return
            const result = await premiumAdmin('updateChannel', { id: channel.id, name })
            if (result.ok && result.catalog) { setCatalog(result.catalog); notify('Renamed', 'success') }
          }}>Rename</button>
          <button type="button" className="text-button" onClick={async () => {
            const result = await premiumAdmin('deleteChannel', { id: channel.id })
            if (result.ok && result.catalog) setCatalog(result.catalog)
          }}>Delete</button>
        </div>
      ))}
    </div>
  )
}

function SettingsPane({ catalog, setCatalog, notify }: { catalog: PremiumCatalog; setCatalog: (catalog: PremiumCatalog) => void; notify: (text: string, tone?: 'success' | 'error') => void }): React.JSX.Element {
  return (
    <div className="settings-card">
      {SETTING_ROWS.map((row) => (
        <label className="setting-row" key={row.key}>
          <span><strong>{row.label}</strong></span>
          <input className="switch" type="checkbox" checked={catalog.settings[row.key]} onChange={async () => {
            const settings = { ...catalog.settings, [row.key]: !catalog.settings[row.key] }
            const result = await premiumAdmin('updateSettings', { settings })
            if (result.ok && result.catalog) { setCatalog(result.catalog); notify(`${row.label} ${settings[row.key] ? 'on' : 'off'}`, 'success') }
            else notify(result.error ?? 'Could not save', 'error')
          }} />
        </label>
      ))}
    </div>
  )
}
