import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  fetchDiscordHealth,
  fetchDiscordImported,
  fetchDiscordStatus,
  listDiscordChannels,
  saveDiscordConfig,
  syncDiscordNow,
  uploadToDiscord,
  DiscordAdminError,
  type DiscordChannelInfo,
  type DiscordHealthStatus,
  type DiscordImportedMedia,
  type DiscordSyncResult,
  type DiscordSyncStatus
} from '../lib/discordAdmin'
import { ADMIN_KEY, fetchPremiumCatalog, premiumAdmin, type PremiumCatalog } from '../lib/premium'
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

const INTERVAL_OPTIONS = [30000, 60000, 300000, 600000, 1800000]

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

function intervalLabel(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)} seconds`
  return `${Math.round(ms / 60000)} minute${ms === 60000 ? '' : 's'}`
}

/**
 * Discord admin console.
 *
 * Discord is the media source: the admin maps guild channels onto Premium
 * sections, turns auto-sync on, and from then on anything posted or forwarded
 * into those channels appears in Premium by itself. The bot token stays on the
 * server — it is never sent to the browser.
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

        {status?.error && <p className="login-error" role="alert">{status.error}</p>}

        <div className="home-header-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={refresh}>
            {busy ? 'Checking…' : 'Refresh'}
          </button>
        </div>
      </div>

      {status?.overall === 'ok' && (
        <>
          <DiscordAutoSyncCard channels={channels} reloadChannels={() => void loadChannels().catch(() => undefined)} onChanged={changed} />
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
            <li><code>DISCORD_CHANNEL_ID</code> — Fallback channel for uploads</li>
          </ul>
          <p className="form-help">
            Required bot permissions: View Channel, Read Message History (plus Attach Files
            and Send Messages for uploads). The token stays server-side only.
          </p>
        </div>
      )}
    </>
  )
}

/** Auto-sync: mapping, interval, Sync Now, status and the error log. */
function DiscordAutoSyncCard({ channels, reloadChannels, onChanged }: { channels: DiscordChannelInfo[]; reloadChannels: () => void; onChanged: () => void }): React.JSX.Element {
  const { notify } = useApp()
  const [status, setStatus] = useState<DiscordSyncStatus | null>(null)
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)
  const [imported, setImported] = useState<DiscordImportedMedia[]>([])
  /** discordChannelId → premium channel id ('' = not synced) */
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [kinds, setKinds] = useState<Record<string, string[]>>({})
  const [autoSync, setAutoSync] = useState(true)
  const [intervalMs, setIntervalMs] = useState(60000)
  const [perChannel, setPerChannel] = useState(25)
  const [mirror, setMirror] = useState(false)
  const [filter, setFilter] = useState('')
  const [newSection, setNewSection] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<DiscordSyncResult | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    const [syncStatus, premiumCatalog, stored] = await Promise.all([
      fetchDiscordStatus(ADMIN_KEY),
      fetchPremiumCatalog(),
      fetchDiscordImported(ADMIN_KEY).catch(() => ({ media: [], status: null }))
    ])
    setStatus(syncStatus)
    setCatalog(premiumCatalog)
    setImported(stored.media || [])
    setAutoSync(syncStatus.autoSync)
    setIntervalMs(syncStatus.intervalMs)
    setPerChannel(syncStatus.perChannel)
    setMirror(syncStatus.mode === 'store')
    setTargets(Object.fromEntries(syncStatus.mappings.map((mapping) => [mapping.discordChannelId, mapping.channelId])))
    setKinds(Object.fromEntries(syncStatus.mappings.map((mapping) => [mapping.discordChannelId, mapping.kinds?.length ? mapping.kinds : ['image', 'video']])))
  }

  useEffect(() => {
    void load().catch((caught) => setError(caught instanceof DiscordAdminError ? caught.message : 'Could not load the Discord sync settings.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mappedCount = Object.values(targets).filter(Boolean).length
  const sections = catalog?.channels ?? []

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle ? channels.filter((channel) => channel.name.toLowerCase().includes(needle)) : channels
  }, [channels, filter])

  const save = async (patch: Record<string, unknown> = {}) => {
    setBusy(true)
    setError('')
    try {
      const mappings = Object.entries(targets)
        .filter(([, channelId]) => channelId)
        .map(([discordChannelId, channelId]) => ({
          discordChannelId,
          channelId,
          name: channels.find((channel) => channel.id === discordChannelId)?.name ?? '',
          kinds: kinds[discordChannelId]?.length ? kinds[discordChannelId] : ['image', 'video']
        }))
      const saved = await saveDiscordConfig(ADMIN_KEY, { mappings, autoSync, intervalMs, perChannel, mode: mirror ? 'store' : 'link', ...patch })
      setStatus(saved.status)
      onChanged()
      notify('Discord sync settings saved', 'success')
    } catch (caught) {
      setError(caught instanceof DiscordAdminError ? caught.message : 'Could not save the Discord sync settings.')
    } finally {
      setBusy(false)
    }
  }

  const syncNow = async (full = false) => {
    if (!mappedCount) { notify('Pehle ek channel map karo', 'error'); return }
    setSyncing(true)
    setError('')
    try {
      await save()
      const summary = await syncDiscordNow(ADMIN_KEY, { full }, (partial) => setResult(partial))
      setResult(summary)
      const stored = await fetchDiscordImported(ADMIN_KEY).catch(() => ({ media: [], status: null }))
      setImported(stored.media || [])
      if (stored.status) setStatus(stored.status)
      onChanged()
      notify(`Sync done · ${summary.imported} new media · ${summary.scanned} messages`, 'success')
    } catch (caught) {
      setError(caught instanceof DiscordAdminError ? caught.message : 'Discord sync failed.')
    } finally {
      setSyncing(false)
    }
  }

  const createSection = async () => {
    const name = newSection.trim()
    if (!name) return
    const created = await premiumAdmin('createChannel', { name, type: 'mixed', status: 'on', order: (catalog?.channels.length ?? 0) + 1 })
    if (created.ok && created.catalog) { setCatalog(created.catalog); setNewSection(''); notify(`Section "${name}" created`, 'success') }
    else notify(created.error ?? 'Section create fail', 'error')
  }

  return (
    <>
      <div className="settings-card">
        <div className="setting-row">
          <span><strong>Discord auto-sync</strong><small>Discord channel → Premium section</small></span>
          <StatusBadge ok={mappedCount > 0}>{mappedCount ? `${mappedCount} mapped` : 'Not mapped'}</StatusBadge>
        </div>

        <label className="setting-row">
          <span><strong>Auto-sync</strong><small>Har {intervalLabel(intervalMs)} me naya media apne aap</small></span>
          <input className="switch" type="checkbox" checked={autoSync} onChange={(event) => setAutoSync(event.target.checked)} />
        </label>

        <div className="setting-row">
          <span><strong>Check every</strong><small>Server bhi read-time pe sync karta hai</small></span>
          <select value={intervalMs} onChange={(event) => setIntervalMs(Number(event.target.value))}>
            {INTERVAL_OPTIONS.map((value) => <option key={value} value={value}>{intervalLabel(value)}</option>)}
          </select>
        </div>

        <div className="setting-row">
          <span><strong>History depth</strong><small>Pehli baar kitne purane messages padhein</small></span>
          <select value={perChannel} onChange={(event) => setPerChannel(Number(event.target.value))}>
            {[10, 25, 50, 100].map((value) => <option key={value} value={value}>{value} messages</option>)}
          </select>
        </div>

        <label className="setting-row">
          <span><strong>Keep a local copy</strong><small>OFF = media Discord CDN se hi stream hota hai (recommended)</small></span>
          <input className="switch" type="checkbox" checked={mirror} onChange={(event) => setMirror(event.target.checked)} />
        </label>

        {!channels.length && (
          <>
            <p className="form-help">No text channels found in the configured guild. Check that the bot is a member and can read channels.</p>
            <button className="secondary-button" type="button" onClick={reloadChannels}>Reload channels</button>
          </>
        )}

        {channels.length > 0 && (
          <>
            <div className="premium-post-form"><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search Discord channels" /></div>
            {visible.map((channel) => (
              <div className="setting-row discord-mapping" key={channel.id}>
                <span>
                  <strong>#{channel.name}</strong>
                  <small>{channel.type === 'announcement' ? 'Announcement' : 'Text'}{channel.topic ? ` · ${channel.topic}` : ''}</small>
                </span>
                <select
                  value={targets[channel.id] ?? ''}
                  onChange={(event) => setTargets((current) => ({ ...current, [channel.id]: event.target.value }))}
                >
                  <option value="">— not synced —</option>
                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>{section.name} ({section.type})</option>
                  ))}
                </select>
                <div className="discord-mapping__kinds">
                  {(['image', 'video'] as const).map((kind) => {
                    const active = (kinds[channel.id] ?? ['image', 'video']).includes(kind)
                    return (
                      <button
                        key={kind}
                        type="button"
                        className={active ? 'is-active' : ''}
                        disabled={!targets[channel.id]}
                        onClick={() => setKinds((current) => {
                          const list = current[channel.id] ?? ['image', 'video']
                          const next = active ? list.filter((entry) => entry !== kind) : [...list, kind]
                          return { ...current, [channel.id]: next.length ? next : [kind] }
                        })}
                      >
                        {kind === 'image' ? 'Images' : 'Videos'}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            <div className="collection-form">
              <input value={newSection} onChange={(event) => setNewSection(event.target.value)} placeholder="New Premium section name" />
              <button className="secondary-button" type="button" onClick={() => void createSection()}>+ Section</button>
            </div>

            <button className="primary-button primary-button--wide" type="button" disabled={busy || !mappedCount} onClick={() => void save()}>
              {busy ? 'Saving…' : `Save mapping (${mappedCount})`}
            </button>
          </>
        )}

        {error && <p className="login-error" role="alert">{error}</p>}
      </div>

      <div className="settings-card">
        <div className="setting-row">
          <span><strong>Sync status</strong><small>{status?.lastSyncAt ? `Last successful sync ${new Date(status.lastSyncAt).toLocaleString('en-IN')}` : 'No sync yet'}</small></span>
          <StatusBadge ok={autoSync && mappedCount > 0}>{autoSync && mappedCount ? 'Auto' : 'Manual'}</StatusBadge>
        </div>
        {status && (
          <div className="setting-row">
            <span><strong>Imported so far</strong><small>{status.totals.images} images · {status.totals.videos} videos</small></span>
            <strong>{status.totals.media}</strong>
          </div>
        )}
        {status?.mappings.map((mapping) => (
          <div className="setting-row" key={mapping.discordChannelId}>
            <span>
              <strong>#{mapping.name || mapping.discordChannelId}</strong>
              <small>
                → {mapping.channelName || 'its own section'} · {mapping.media} media
                {mapping.lastSyncAt ? ` · synced ${new Date(mapping.lastSyncAt).toLocaleTimeString('en-IN')}` : ' · not synced yet'}
              </small>
            </span>
          </div>
        ))}
        <div className="home-header-actions">
          <button className="primary-button" type="button" disabled={syncing || !mappedCount} onClick={() => void syncNow(false)}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button className="secondary-button" type="button" disabled={syncing || !mappedCount} onClick={() => void syncNow(true)}>
            Re-scan history
          </button>
        </div>

        {result && (
          <div className="premium-progress">
            <p>Scanned {result.scanned} messages · {result.imported} imported · {result.skipped} already stored · {result.failed} failed</p>
            <i style={{ width: `${Math.min(100, Math.round((result.imported / Math.max(result.attachments, 1)) * 100))}%` }} />
            <small>
              Media source: {status?.mode === 'store' ? 'local copy' : 'Discord CDN (no second storage)'}
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

        {status?.errors.length ? (
          <>
            <div className="setting-row"><span><strong>Errors</strong><small>Latest first</small></span><strong>{status.errors.length}</strong></div>
            {status.errors.slice(0, 8).map((entry, index) => (
              <p className="form-help discord-error" key={`${entry.at}-${index}`}>
                {new Date(entry.at).toLocaleString('en-IN')}{entry.channel ? ` · #${entry.channel}` : ''} — {entry.message}
              </p>
            ))}
          </>
        ) : null}
      </div>

      {imported.length > 0 && (
        <div className="settings-card">
          <div className="setting-row"><span><strong>Stored media</strong><small>Sabse naya pehle</small></span><strong>{imported.length}</strong></div>
          <div className="discord-imported">
            {imported.slice(0, 24).map((item) => (
              <figure className="discord-imported__item" key={item.id}>
                {item.kind === 'image'
                  ? <img src={item.url} alt={item.title} loading="lazy" style={UNCROPPED_IMAGE_STYLE} />
                  : <video src={item.url} controls preload="metadata" playsInline style={UNCROPPED_IMAGE_STYLE} />}
                <figcaption>
                  <strong>{item.title || item.filename || item.id}</strong>
                  <small>{item.targetChannelName || item.channelName || item.channelId} · {item.width && item.height ? `${item.width}×${item.height} · ` : ''}{formatBytes(item.bytes)}</small>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </>
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
