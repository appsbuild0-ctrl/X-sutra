import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  deleteUpload,
  fetchAdminUploads,
  TelegramLoginError,
  updateUpload,
  uploadFile,
  type UploadRecord
} from '../lib/telegramLogin'

const ACCESS_LABELS: Array<[UploadRecord['accessRole'], string]> = [
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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new TelegramLoginError('That image could not be read.'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}

/**
 * Admin uploads, stored in the existing Neon PostgreSQL database and served back
 * through /api/uploads/<id>. Every action is authorised on the server (admin
 * X-Sutra JWT re-checked against the database), so this UI is a convenience,
 * never the gate.
 */
export function AdminUploads(): React.JSX.Element {
  const { notify } = useApp()
  const [uploads, setUploads] = useState<UploadRecord[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('General')
  const [thumbnail, setThumbnail] = useState('')
  const [accessRole, setAccessRole] = useState<UploadRecord['accessRole']>('public')
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const thumbInput = useRef<HTMLInputElement | null>(null)

  const reload = useCallback(async () => {
    try {
      const data = await fetchAdminUploads()
      setUploads(data.uploads)
      setCategories(data.categories.map((entry) => entry.category))
    } catch (caught) {
      setError(caught instanceof TelegramLoginError ? caught.message : 'Uploads could not load.')
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const pickFile = (picked: File | null): void => {
    setFile(picked)
    setError('')
    if (picked && !title.trim()) setTitle(picked.name.replace(/\.[^.]+$/, '').slice(0, 100))
  }

  const pickThumbnail = async (picked: File | null): Promise<void> => {
    if (!picked) return
    if (!picked.type.startsWith('image/')) {
      setError('Thumbnail must be an image.')
      return
    }
    if (picked.size > 600_000) {
      setError('Thumbnail is too large — use an image under 600 KB.')
      return
    }
    try {
      setThumbnail(await fileToDataUrl(picked))
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Thumbnail could not be read.')
    }
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
      const upload = await uploadFile(file, { title, category, thumbnail, accessRole }, setProgress)
      notify(`Uploaded “${upload.title}” — it is live now`, 'success')
      setFile(null)
      setTitle('')
      setThumbnail('')
      setProgress(null)
      if (fileInput.current) fileInput.current.value = ''
      if (thumbInput.current) thumbInput.current.value = ''
      await reload()
    } catch (caught) {
      setProgress(null)
      const message = caught instanceof TelegramLoginError ? caught.message : 'Upload failed.'
      setError(message)
      notify(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (upload: UploadRecord): Promise<void> => {
    if (!window.confirm(`Delete “${upload.title}”? This removes the file from the database.`)) return
    try {
      await deleteUpload(upload.id)
      notify('Upload deleted', 'success')
      await reload()
    } catch (caught) {
      setError(caught instanceof TelegramLoginError ? caught.message : 'Delete failed.')
    }
  }

  const patch = async (upload: UploadRecord, changes: Partial<UploadRecord>): Promise<void> => {
    try {
      const updated = await updateUpload(upload.id, {
        title: changes.title ?? upload.title,
        category: changes.category ?? upload.category,
        accessRole: changes.accessRole ?? upload.accessRole,
        published: changes.published ?? upload.published
      })
      setUploads((current) => current.map((row) => (row.id === updated.id ? updated : row)))
      notify('Upload updated', 'success')
    } catch (caught) {
      setError(caught instanceof TelegramLoginError ? caught.message : 'Update failed.')
    }
  }

  return (
    <>
      <div className="premium-post-form settings-card" style={{ padding: 14 }}>
        <strong>Upload content</strong>
        <p className="form-help">
          Video, image, audio or PDF. Files are stored in your Neon database and appear in Premium automatically — the
          existing player and downloads keep working.
        </p>

        <label className="login-field">
          <span>File</span>
          <input
            ref={fileInput}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/mp4,application/pdf"
            onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <label className="login-field">
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title shown in the app" maxLength={120} />
        </label>

        <label className="login-field">
          <span>Category</span>
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            list="xs-upload-categories"
            placeholder="Existing or new category"
            maxLength={48}
          />
          <datalist id="xs-upload-categories">
            {categories.map((entry) => <option key={entry} value={entry} />)}
          </datalist>
        </label>

        <label className="login-field">
          <span>Thumbnail (optional)</span>
          <input ref={thumbInput} type="file" accept="image/*" onChange={(event) => void pickThumbnail(event.target.files?.[0] ?? null)} />
        </label>
        {thumbnail && <img src={thumbnail} alt="Thumbnail preview" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 10 }} />}

        <label className="login-field">
          <span>Who can see it</span>
          <select value={accessRole} onChange={(event) => setAccessRole(event.target.value as UploadRecord['accessRole'])}>
            {ACCESS_LABELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        {progress !== null && (
          <div className="upload-progress" role="status">
            <div className="upload-progress__bar" style={{ width: `${Math.round(progress * 100)}%` }} />
            <span>{Math.round(progress * 100)}% uploaded</span>
          </div>
        )}
        {error && <p className="login-error" role="alert">{error}</p>}

        <button className="primary-button" type="button" disabled={busy || !file} onClick={() => void submit()}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      <div className="settings-card">
        {uploads.length === 0 && <p className="form-help" style={{ margin: 0 }}>Nothing uploaded yet.</p>}
        {uploads.map((upload) => (
          <div className="setting-row" key={upload.id} style={{ flexWrap: 'wrap', gap: 8 }}>
            <span>
              <strong>{upload.title}</strong>
              <small>
                {upload.kind} · {upload.category} · {formatBytes(upload.bytes)} ·{' '}
                {upload.status === 'ready' ? 'live' : 'still uploading'} · {ACCESS_LABELS.find(([value]) => value === upload.accessRole)?.[1] ?? upload.accessRole}
              </small>
            </span>
            {editing === upload.id ? (
              <>
                <input defaultValue={upload.title} maxLength={120} onBlur={(event) => void patch(upload, { title: event.target.value })} />
                <input defaultValue={upload.category} maxLength={48} onBlur={(event) => void patch(upload, { category: event.target.value })} />
                <button className="text-button" type="button" onClick={() => setEditing(null)}>Done</button>
              </>
            ) : (
              <>
                <button className="text-button" type="button" onClick={() => setEditing(upload.id)}>Edit</button>
                <button className="text-button" type="button" onClick={() => void patch(upload, { published: !upload.published })}>
                  {upload.published ? 'Unpublish' : 'Publish'}
                </button>
                <a className="text-button" href={`/api/uploads/${upload.id}`} target="_blank" rel="noreferrer">Open</a>
                <button className="text-button" type="button" onClick={() => void remove(upload)}>Delete</button>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
