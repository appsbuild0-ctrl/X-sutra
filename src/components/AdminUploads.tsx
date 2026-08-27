import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  deleteDiscordMedia,
  DiscordError,
  fetchAdminDiscordMedia,
  fetchDiscordStatus,
  uploadDiscordFile,
  type DiscordMedia,
  type DiscordStatus
} from '../lib/discord'

const ACCESS_LABELS: Array<[DiscordMedia['accessRole'], string]> = [
  ['public', '🌐 Everyone'],
  ['premium', '⭐ Premium + VIP'],
  ['vip', '💎 VIP only'],
  ['admin', '👑 Admins only']
]

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

/**
 * Discord-backed uploads. The file goes: browser → X-Sutra backend → Discord
 * REST → configured channel. The DB mapping is stored only after Discord
 * returns a real message id, so there is never a fake success.
 */
export function AdminUploads(): React.JSX.Element {
  const { notify } = useApp()
  const [status, setStatus] = useState<DiscordStatus | null>(null)
  const [media, setMedia] = useState<DiscordMedia[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [accessRole, setAccessRole] = useState<DiscordMedia['accessRole']>('premium')
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement | null>(null)

  const reload = useCallback(async () => {
    try {
      setStatus(await fetchDiscordStatus())
      setMedia((await fetchAdminDiscordMedia()).media)
    } catch (caught) {
      setError(caught instanceof DiscordError ? caught.message : 'Discord could not be reached.')
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const pickFile = (picked: File | null): void => {
    setFile(picked)
    setError('')
    if (picked && !title.trim()) setTitle(picked.name.replace(/\.[^.]+$/, '').slice(0, 100))
  }

  const submit = async (): Promise<void> => {
    if (!file) {
      setError('Choose a file to upload.')
      return
    }
    setBusy(true)
    setError('')
    setProgress(0)
    try {
      const uploaded = await uploadDiscordFile(file, { title, description, accessRole }, setProgress)
      notify(`Uploaded “${uploaded.title}” to Discord`, 'success')
      setFile(null)
      setTitle('')
      setDescription('')
      setProgress(null)
      if (fileInput.current) fileInput.current.value = ''
      await reload()
    } catch (caught) {
      setProgress(null)
      const message = caught instanceof DiscordError ? caught.message : 'Discord upload failed.'
      setError(message)
      notify(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (item: DiscordMedia): Promise<void> => {
    if (!window.confirm(`Delete “${item.title}”? This removes the Discord message too.`)) return
    try {
      const result = await deleteDiscordMedia(item.id)
      notify(result.alreadyDeleted ? 'Discord message was already deleted; removed from X-Sutra.' : 'Deleted from Discord and X-Sutra.', 'success')
      await reload()
    } catch (caught) {
      setError(caught instanceof DiscordError ? caught.message : 'Delete failed.')
    }
  }

  const ready = status?.configured && status?.guild === 'Found' && status?.channel === 'Found' && (status?.permissions === 'OK')

  return (
    <>
      <div className="settings-card">
        <div className="setting-row"><span><strong>Discord connection</strong></span>
          <span className="online-pill" style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: ready ? '#7ef0c2' : '#ffb4a2', background: ready ? 'rgba(46,204,113,.14)' : 'rgba(255,99,71,.14)' }}>
            {status ? `${status.api ?? 'Unknown'} · Guild: ${status.guild ?? '–'} · Channel: ${status.channel ?? '–'} · Permissions: ${status.permissions ?? '–'}` : 'Checking…'}
          </span>
        </div>
        {status && !status.configured && (
          <p className="form-help" role="alert">Set these environment variables on the server: {(status.missing ?? []).join(', ')}.</p>
        )}
        {status?.configured && status.permissions === 'Missing' && (
          <p className="form-help" role="alert">Bot is missing permissions in the channel — grant View Channel, Send Messages, Attach Files, Read Message History.</p>
        )}
        <div className="home-header-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void reload()}>Refresh</button>
        </div>
      </div>

      <div className="premium-post-form settings-card" style={{ padding: 14 }}>
        <strong>Upload to Discord</strong>
        <p className="form-help">
          The file is posted to your configured Discord channel and stored as a real message. Up to 8 MB per file
          (Discord's limit without boosts).
        </p>

        <label className="login-field">
          <span>File</span>
          <input ref={fileInput} type="file" onChange={(event) => pickFile(event.target.files?.[0] ?? null)} />
        </label>
        <label className="login-field">
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title shown in the app" maxLength={120} />
        </label>
        <label className="login-field">
          <span>Description (optional)</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Short description" maxLength={240} />
        </label>
        <label className="login-field">
          <span>Who can see it</span>
          <select value={accessRole} onChange={(event) => setAccessRole(event.target.value as DiscordMedia['accessRole'])}>
            {ACCESS_LABELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        {progress !== null && (
          <div className="upload-progress" role="status">
            <div className="upload-progress__bar" style={{ width: `${Math.round(progress * 100)}%` }} />
            <span>{Math.round(progress * 100)}% sent to server</span>
          </div>
        )}
        {error && <p className="login-error" role="alert">{error}</p>}

        <button className="primary-button" type="button" disabled={busy || !file} onClick={() => void submit()}>
          {busy ? 'Uploading…' : 'Upload to Discord'}
        </button>
      </div>

      <div className="settings-card">
        <div className="setting-row"><span><strong>Discord content</strong></span><small>{media.length}</small></div>
        {media.length === 0 && <p className="form-help" style={{ margin: 0 }}>Nothing uploaded yet.</p>}
        {media.map((item) => (
          <div className="setting-row" key={item.id} style={{ flexWrap: 'wrap', gap: 8 }}>
            <span>
              <strong>{item.title}</strong>
              <small>
                {item.kind} · {formatBytes(item.bytes)} · {item.status} · {ACCESS_LABELS.find(([value]) => value === item.accessRole)?.[1] ?? item.accessRole}
                {item.discordMessageId ? ` · msg ${item.discordMessageId}` : ''}
              </small>
            </span>
            <a className="text-button" href={item.url} target="_blank" rel="noreferrer">Open</a>
            <button className="text-button" type="button" onClick={() => void remove(item)}>Delete</button>
          </div>
        ))}
      </div>
    </>
  )
}
