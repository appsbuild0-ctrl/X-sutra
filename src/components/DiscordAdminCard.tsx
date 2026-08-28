import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  fetchDiscordHealth,
  listDiscordChannels,
  syncDiscordChannels,
  fetchDiscordImported,
  uploadToDiscord,
  DiscordAdminError,
  type DiscordChannelInfo,
  type DiscordHealthStatus,
  type DiscordImportedMedia,
  type DiscordSyncResult
} from '../lib/discordAdmin'
import { ADMIN_KEY } from '../lib/premium'
import { UNCROPPED_IMAGE_STYLE } from '../lib/imageFit'

type Stage = 'loading' | 'ready' | 'connected'
type UploadState = 'waiting' | 'uploading' | 'done' | 'failed'

interface UploadRow {
  file: File
  preview: string
  status: UploadState
  url?: string
  error?: string
}

function StatusBadge({ ok, children }: { ok: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <span
      className="online-pill"
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: ok ? '#7ef0c2' : '#ffb4a2',
        background: ok ? 'rgba(46, 204, 113, .14)' : 'rgba(255, 99, 71, .14)'
      }}
    >
      {children}
    </span>
  )
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

/**
 * Discord admin card: bot health, real channel import (messages + images +
 * videos stored with their channel) and uploads to a channel the admin picks.
 * The bot token is NEVER displayed.
 */
export function DiscordAdminCard({ onChanged }: { onChanged?: () => void }): React.JSX.Element {
  const { notify } = useApp()
  const changed = () => { onChanged?.() }
  const [stage, setStage] = useState<Stage>('loading')
  const [status, setStatus] = useState<DiscordHealthStatus | null>(null)
  const [channels, setChannels] = useState<DiscordChannelInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const booted = useRef(false)

  const run = async (job: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await job()
    } catch (caught) {
      setError(caught instanceof DiscordAdminError ? caught.message : 'Discord operation failed.')
    } finally {
      setBusy(false)
    }
  }

  const loadChannels = async () => {
    const result = await listDiscordChannels(ADMIN_KEY)
    setChannels(Array.isArray(result.channels) ? result.channels : [])
  }

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void run(async () => {
      const result = await fetchDiscordHealth()
      setStatus(result)
      setStage(result.overall === 'ok' ? 'connected' : 'ready')
      if (result.overall === 'ok') await loadChannels().catch(() => setChannels([]))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = () => void run(async () => {
    const result = await fetchDiscordHealth()
    setStatus(result)
    setStage(result.overall === 'ok' ? 'connected' : 'ready')
    if (result.overall === 'ok') await loadChannels().catch(() => setChannels([]))
    changed()
  })

  if (stage === 'loading') {
    return (
      <div className="settings-card">
        <p className="form-help" style={{ margin: 0 }}>{busy ? 'Checking Discord connection…' : 'Connecting to Discord…'}</p>
        {error && <p className="login-error" role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <>
      <div className="settings-card">
        <div className="setting-row">
          <span><strong>Discord Bot</strong></span>
          {status ? (
            <StatusBadge ok={status.overall === 'ok'}>
              {status.overall === 'ok' ? 'Connected' : 'Not connected'}
            </StatusBadge>
          ) : <small>Checking…</small>}
        </div>

        {status?.botUser && (
          <div className="setting-row">
            <span><strong>Bot User</strong></span>
            <small>@{status.botUser.username}</small>
          </div>
        )}

        <div className="setting-row">
          <span><strong>Server (Guild)</strong></span>
          {status?.guild ? (
            <StatusBadge ok={status.guild.found}>
              {status.guild.found ? status.guild.name : 'Not found'}
            </StatusBadge>
          ) : <small>—</small>}
        </div>

        <div className="setting-row">
          <span><strong>Channels found</strong></span>
          <strong>{channels.length}</strong>
        </div>

        <div className="setting-row">
          <span><strong>Default channel</strong></span>
          {status?.channel?.found ? <small>#{status.channel.name}</small> : <small>Not configured</small>}
        </div>

        {status?.error && (
          <p className="login-error" role="alert">{status.error}</p>
        )}

        <div className="home-header-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={refresh}>
            {busy ? 'Checking…' : 'Refresh'}
          </button>
        </div>
      </div>

      {status?.overall === 'ok' && (
        <>
          <DiscordImportCard channels={channels} reloadChannels={() => void loadChannels().catch(() => undefined)} onChanged={changed} />
          <DiscordUploadCard channels={channels} onChanged={changed} />
        </>
      )}

      {status?.overall !== 'ok' && (
        <div className="settings-card">
          <p className="form-help">
            ⚠️ Discord bot is not connected. Configure these environment variables on your
            hosting provider and redeploy:
          </p>
          <ul className="form-help" style={{ margin: '8px 0', paddingLeft: 20 }}>
            <li><code>DISCORD_BOT_TOKEN</code> — Your bot token from Discord Developer Portal</li>
            <li><code>DISCORD_GUILD_ID</code> — Your Discord server ID</li>
            <li><code>DISCORD_CHANNEL_ID</code> — Target channel ID for uploads</li>
            <li><code>DISCORD_ADMIN_USER_ID</code> — Your Discord user ID for admin operations</li>
          </ul>
          <p className="form-help">
            Required bot permissions: View Channel, Send Messages, Read Message History,
            Attach Files, Embed Links, Manage Messages (for deletion).
          </p>
        </div>
      )}
    </>
  )
}

/** Real import: pick channels → pull their messages, store every image/video. */
function DiscordImportCard({ channels, reloadChannels, onChanged }: { channels: DiscordChannelInfo[]; reloadChannels: () => void; onChanged: () => void }): React.JSX.Element {
  const { notify } = useApp()
  const [selected, setSelected] = useState<string[]>([])
  const [perChannel, setPerChannel] = useState(25)
  const [images, setImages] = useState(true)
  const [videos, setVideos] = useState(true)
  const [filter, setFilter] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DiscordSyncResult | null>(null)
  const [imported, setImported] = useState<DiscordImportedMedia[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    void fetchDiscordImported(ADMIN_KEY).then((data) => setImported(data.media || [])).catch(() => setImported([]))
  }, [])

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle ? channels.filter((channel) => channel.name.toLowerCase().includes(needle)) : channels
  }, [channels, filter])

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])

  const start = async () => {
    if (!selected.length) { notify('Select kam se kam ek channel', 'error'); return }
    const kinds = [...(images ? ['image'] : []), ...(videos ? ['video'] : [])]
    if (!kinds.length) { notify('Images ya videos me se ek toh chuno', 'error'); return }
    setError('')
    setRunning(true)
    try {
      const summary = await syncDiscordChannels(ADMIN_KEY, { channelIds: selected, perChannel, kinds }, (partial) => setResult(partial))
      setResult(summary)
      const fresh = await fetchDiscordImported(ADMIN_KEY).catch(() => ({ media: [] }))
      setImported(fresh.media || [])
      onChanged()
      notify(`Discord import · ${summary.imported} media · ${summary.scanned} messages`, 'success')
    } catch (caught) {
      setError(caught instanceof DiscordAdminError ? caught.message : 'Discord import failed.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="settings-card">
      <div className="setting-row">
        <span><strong>Import from Discord</strong><small>Real messages, images aur videos selected channels se</small></span>
        <StatusBadge ok={channels.length > 0}>{channels.length ? `${channels.length} channels` : 'No channels'}</StatusBadge>
      </div>

      {!channels.length && (
        <>
          <p className="form-help">No text channels were found in the configured guild. Check that the bot is a member of the server and can read channels.</p>
          <button className="secondary-button" type="button" onClick={reloadChannels}>Reload channels</button>
        </>
      )}

      {channels.length > 0 && (
        <>
          <div className="premium-post-form">
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search channels" />
          </div>
          <div className="home-header-actions">
            <button className="text-button" type="button" onClick={() => setSelected(visible.map((channel) => channel.id))}>Select all</button>
            <button className="text-button" type="button" onClick={() => setSelected([])}>Clear</button>
          </div>
          {visible.map((channel) => (
            <label className="setting-row" key={channel.id}>
              <span>
                <strong>#{channel.name}</strong>
                <small>{channel.type === 'announcement' ? 'Announcement' : 'Text'}{channel.topic ? ` · ${channel.topic}` : ''}</small>
              </span>
              <input className="switch" type="checkbox" checked={selected.includes(channel.id)} onChange={() => toggle(channel.id)} />
            </label>
          ))}

          <div className="setting-row">
            <span><strong>Messages per channel</strong><small>History depth read on each import</small></span>
            <select value={perChannel} onChange={(event) => setPerChannel(Number(event.target.value))}>
              {[10, 25, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <label className="setting-row"><span><strong>Images</strong></span><input className="switch" type="checkbox" checked={images} onChange={(event) => setImages(event.target.checked)} /></label>
          <label className="setting-row"><span><strong>Videos</strong></span><input className="switch" type="checkbox" checked={videos} onChange={(event) => setVideos(event.target.checked)} /></label>

          <button className="primary-button primary-button--wide" type="button" disabled={running || !selected.length} onClick={() => void start()}>
            {running ? 'Importing…' : `Import selected (${selected.length})`}
          </button>
        </>
      )}

      {error && <p className="login-error" role="alert">{error}</p>}

      {result && (
        <div className="premium-progress">
          <p>Scanned {result.scanned} messages · {result.imported} imported · {result.skipped} already stored · {result.failed} failed</p>
          <i style={{ width: `${Math.min(100, Math.round((result.imported / Math.max(result.attachments, 1)) * 100))}%` }} />
          <small>
            Database index: {result.database === 'saved' ? 'saved' : 'skipped (no DATABASE_URL)'}
            {result.partial ? ` · ${result.nextChannelIds.length} channels still queued` : ''}
          </small>
          {result.channels.map((channel) => (
            <small key={channel.id}>
              #{channel.name} · {channel.messages} messages · {channel.imported} imported · {channel.skipped} skipped
              {channel.failed ? ` · ${channel.failed} failed` : ''}{channel.error ? ` · ${channel.error}` : ''}
            </small>
          ))}
        </div>
      )}

      {imported.length > 0 && (
        <>
          <div className="setting-row"><span><strong>Stored media</strong><small>Saved with its channel</small></span><strong>{imported.length}</strong></div>
          <div className="discord-imported">
            {imported.slice(0, 24).map((item) => (
              <figure className="discord-imported__item" key={item.id}>
                {item.kind === 'image'
                  ? <img src={item.url} alt={item.title} loading="lazy" style={UNCROPPED_IMAGE_STYLE} />
                  : <video src={item.url} controls preload="metadata" playsInline style={UNCROPPED_IMAGE_STYLE} />}
                <figcaption>
                  <strong>{item.title || item.id}</strong>
                  <small>#{item.channelName || item.channelId} · {item.width && item.height ? `${item.width}×${item.height} · ` : ''}{formatBytes(item.bytes)}</small>
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Uploads go to the channel selected here — not just the server default. */
function DiscordUploadCard({ channels, onChanged }: { channels: DiscordChannelInfo[]; onChanged: () => void }): React.JSX.Element {
  const { notify } = useApp()
  const [rows, setRows] = useState<UploadRow[]>([])
  const [targetId, setTargetId] = useState('')
  const [caption, setCaption] = useState('')
  const [running, setRunning] = useState(false)

  const target = channels.find((channel) => channel.id === targetId)

  const pick = (files: FileList | null) => {
    const next = [...(files ?? [])].filter((file) => /^(image|video|audio)\//.test(file.type))
    setRows(next.map((file) => ({ file, preview: URL.createObjectURL(file), status: 'waiting' })))
  }

  const upload = async () => {
    if (!targetId) { notify('Upload ke liye channel select karo', 'error'); return }
    setRunning(true)
    let done = 0
    for (const [index, row] of rows.entries()) {
      if (row.status === 'done') continue
      setRows((current) => current.map((entry, position) => position === index ? { ...entry, status: 'uploading' } : entry))
      try {
        const result = await uploadToDiscord(row.file, ADMIN_KEY, caption, targetId)
        setRows((current) => current.map((entry, position) => position === index ? { ...entry, status: 'done', url: result.attachmentUrl } : entry))
        done += 1
      } catch (caught) {
        setRows((current) => current.map((entry, position) => position === index ? { ...entry, status: 'failed', error: caught instanceof DiscordAdminError ? caught.message : 'Upload failed' } : entry))
      }
    }
    setRunning(false)
    onChanged()
    notify(`Discord upload · ${done}/${rows.length} → #${target?.name ?? targetId}`, 'success')
  }

  return (
    <div className="settings-card">
      <div className="setting-row"><span><strong>Upload to Discord</strong><small>Selected channel me files bhejo</small></span></div>
      <div className="setting-row">
        <span><strong>Channel</strong><small>{target ? `#${target.name}` : 'Discord channel chuno'}</small></span>
        <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
          <option value="">Select channel…</option>
          {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
        </select>
      </div>
      <div className="premium-post-form">
        <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Optional caption" />
        <label className="primary-button primary-button--wide">
          Select multiple files
          <input className="sr-only" type="file" accept="image/*,video/*,audio/*" multiple onChange={(event) => pick(event.target.files)} />
        </label>
      </div>
      {rows.length > 0 && (
        <div className="premium-scan-grid">
          {rows.map((row) => (
            <div key={row.file.name + row.file.size} className="premium-scan-item">
              {row.file.type.startsWith('image/')
                ? <img className="premium-scan-item__thumb" src={row.preview} alt="" />
                : <video className="premium-scan-item__thumb" src={row.preview} muted playsInline preload="metadata" />}
              <small>{row.file.name}</small>
              <small>{target ? `→ #${target.name}` : '→ no channel'}</small>
              <small>{row.status}{row.error ? ` · ${row.error}` : ''}</small>
            </div>
          ))}
        </div>
      )}
      <button className="primary-button primary-button--wide" type="button" disabled={running || !rows.length || !targetId} onClick={() => void upload()}>
        {running ? 'Uploading…' : `Upload all (${rows.length})`}
      </button>
    </div>
  )
}
