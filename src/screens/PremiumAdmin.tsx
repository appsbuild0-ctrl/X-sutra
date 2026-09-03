import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  fetchPremiumCatalog,
  hashFile,
  premiumAdmin,
  readMediaSize,
  uploadPremiumFile,
  type PremiumCatalog
} from '../lib/premium'
import { assignFiles, resolveUploadTargets, type UploadKind } from '../lib/uploadPlan'

type AdminView = 'upload' | 'channels' | 'settings'
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
  // Where the selected files go. '' = auto (first usable channel/album), which
  // is only a fallback — an explicit pick always wins.
  const [channelId, setChannelId] = useState('')
  const [albumId, setAlbumId] = useState('')

  if (!catalog.settings.premiumUpload) return <p className="form-help">Premium upload is turned off.</p>

  const selection = useMemo(() => ({ channelId, albumId, kind }), [channelId, albumId, kind])
  const planned = resolveUploadTargets(catalog, selection)
  const channelAlbums = catalog.albums.filter((album) => !planned.channelId || album.channelId === planned.channelId || !album.channelId)

  const pick = (files: FileList | null) => {
    const next = [...(files ?? [])].filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
    setQueue(next.map((file) => ({ file, preview: URL.createObjectURL(file), status: 'waiting' })))
  }

  /**
   * Resolve (and create when missing) the channel + album the whole selection
   * goes to. Every file in the batch is then assigned this exact channel id.
   */
  const ensureTargets = async (current: PremiumCatalog): Promise<{ catalog: PremiumCatalog; channelId: string; albumId: string; channelName: string }> => {
    let next = current
    let targets = resolveUploadTargets(next, selection)
    if (!targets.detached && targets.needsChannel && (autoChannel || autoCategory)) {
      const name = autoCategory && autoChannel ? 'Premium' : autoCategory ? 'Category' : 'Premium'
      const result = await premiumAdmin('createChannel', { name, type: 'mixed', status: 'on', order: next.channels.length + 1 })
      if (result.ok && result.catalog) {
        next = result.catalog
        const created = next.channels.find((entry) => entry.name === name)
        if (created) setChannelId(created.id)
        targets = resolveUploadTargets(next, { ...selection, channelId: created?.id ?? '' })
      }
    }
    if (!targets.detached && targets.needsAlbum && autoAlbum) {
      const result = await premiumAdmin('createAlbum', { name: 'Uploads', description: '', tags: '', channelId: targets.channelId, published: true })
      if (result.ok && result.catalog) {
        next = result.catalog
        const created = next.albums.find((entry) => entry.name === 'Uploads' && (!entry.channelId || entry.channelId === targets.channelId))
        if (created) setAlbumId(created.id)
        targets = resolveUploadTargets(next, { ...selection, channelId: targets.channelId, albumId: created?.id ?? '' })
      }
    }
    setCatalog(next)
    return { catalog: next, channelId: targets.channelId, albumId: targets.albumId, channelName: targets.channelName }
  }

  const uploadQueue = async (onlyFailed = false) => {
    setRunning(true)
    const targets = kind === 'hero' ? { catalog, channelId: '', albumId: '', channelName: '' } : await ensureTargets(catalog)
    const selected = queue.map((item, index) => ({ item, index })).filter(({ item }) => onlyFailed ? item.status === 'failed' : item.status === 'waiting' || item.status === 'failed')
    // One assignment pass: all selected files carry the chosen channel id.
    const plannedFiles = assignFiles(selected.map(({ item }) => ({ file: item.file, item })), { ...targets, albumName: '', detached: kind === 'hero', needsChannel: false, needsAlbum: false })
    let done = 0
    for (const [position, { item, index }] of selected.entries()) {
      const assignment = plannedFiles[position]
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
      const [uploaded, size] = await Promise.all([uploadPremiumFile(item.file), readMediaSize(item.file)])
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
          width: size.width,
          height: size.height,
          role: kind === 'hero' ? 'hero' : 'content'
        }],
        channelId: assignment.channelId,
        albumId: assignment.albumId,
        importDuplicates: allowDupes
      })
      setQueue((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, status: result.ok ? 'done' : 'failed', error: result.error } : entry))
      if (result.ok && result.catalog) setCatalog(result.catalog)
      done += 1
    }
    setRunning(false)
    const target = kind === 'hero' ? 'Hero banner' : assignmentLabel(targets.channelName)
    notify(`Upload finished · ${done} processed → ${target}`, 'success')
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

      <div className="premium-kind-row">
        {(['hero', 'image', 'video', 'album'] as const).map((value) => (
          <button key={value} className={kind === value ? 'is-active' : ''} type="button" onClick={() => setKind(value)}>{value === 'hero' ? 'Poster / Hero' : value}</button>
        ))}
      </div>

      <div className="settings-card">
        <label className="setting-row">
          <span><strong>Channel</strong><small>{kind === 'hero' ? 'Hero banners are not channel content' : planned.needsChannel ? 'No channel yet — one is created on upload' : `${planned.channelName} · every selected file goes here`}</small></span>
          <select value={channelId} disabled={kind === 'hero'} onChange={(event) => { setChannelId(event.target.value); setAlbumId('') }}>
            <option value="">Auto (first active channel)</option>
            {catalog.channels.map((channel) => (
              <option key={channel.id} value={channel.id} disabled={channel.status === 'off'}>
                {channel.name}{channel.status === 'off' ? ' (off)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="setting-row">
          <span><strong>Album</strong><small>{planned.albumName ? `Inside ${planned.albumName}` : 'Optional — leave on none to post directly in the channel'}</small></span>
          <select value={albumId} disabled={kind === 'hero'} onChange={(event) => setAlbumId(event.target.value)}>
            <option value="">None / auto</option>
            {channelAlbums.map((album) => <option key={album.id} value={album.id}>{album.name}</option>)}
          </select>
        </label>
        <label className="setting-row"><span><strong>Create channel</strong><small>ON = upload pe Premium channel apne aap</small></span><input className="switch" type="checkbox" checked={autoChannel} onChange={(event) => setAutoChannel(event.target.checked)} /></label>
        <label className="setting-row"><span><strong>Create category</strong><small>ON = category Home pe apne aap</small></span><input className="switch" type="checkbox" checked={autoCategory} onChange={(event) => setAutoCategory(event.target.checked)} /></label>
        <label className="setting-row"><span><strong>Albums</strong><small>ON = Uploads album apne aap</small></span><input className="switch" type="checkbox" checked={autoAlbum} onChange={(event) => setAutoAlbum(event.target.checked)} /></label>
        <label className="setting-row"><span><strong>Upload duplicates</strong></span><input className="switch" type="checkbox" checked={allowDupes} onChange={(event) => setAllowDupes(event.target.checked)} /></label>
      </div>

      <input value={directUrl} onChange={(event) => setDirectUrl(event.target.value)} placeholder="Or paste image/video URL (https://...)" inputMode="url" />
      <button className="secondary-button" type="button" onClick={async () => {
        const url = directUrl.trim()
        if (!/^https?:\/\//i.test(url)) return notify('Valid https URL chahiye', 'error')
        const targets = kind === 'hero' ? { catalog, channelId: '', albumId: '', channelName: '' } : await ensureTargets(catalog)
        const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) || kind === 'video'
        const result = await premiumAdmin('importMedia', {
          items: [{ url, type: isVideo ? 'video' : 'image', filename: url, thumbnail: isVideo ? '' : url, title: 'Premium media', role: kind === 'hero' ? 'hero' : 'content' }],
          channelId: targets.channelId,
          albumId: targets.albumId
        })
        if (result.ok && result.catalog) { setCatalog(result.catalog); setDirectUrl(''); notify(`URL published → ${assignmentLabel(targets.channelName)}`, 'success') }
        else notify(result.error ?? 'URL publish fail', 'error')
      }}>Publish URL</button>

      {queue.length > 0 && (
        <div className="premium-scan-grid">
          {queue.map((item) => (
            <div key={item.file.name + item.file.size} className="premium-scan-item">
              {item.file.type.startsWith('image/')
                ? <img className="premium-scan-item__thumb" src={item.preview} alt="" />
                : <video className="premium-scan-item__thumb" src={item.preview} muted playsInline preload="metadata" />}
              <small>{item.file.name}</small>
              <small>{kind === 'hero' ? 'Hero banner' : `→ ${assignmentLabel(planned.channelName)}`}</small>
              <small>{item.status}{item.error ? ` · ${item.error}` : ''}</small>
            </div>
          ))}
        </div>
      )}

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
        {running ? 'Uploading…' : `Upload all (${queue.length}) → ${kind === 'hero' ? 'Hero' : assignmentLabel(planned.channelName)}`}
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

function assignmentLabel(name: string): string {
  return name.trim() ? name : 'new channel'
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
