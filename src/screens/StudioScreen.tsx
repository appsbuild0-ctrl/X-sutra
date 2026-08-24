import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import { MediaGrid } from '../components/MediaGrid'
import { StudioIcon, UploadIcon, TrashIcon, CheckIcon, LogOutIcon, RefreshIcon, DownloadIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { useStudioMedia } from '../hooks/useStudioMedia'
import { studioApi } from '../lib/studioMedia'
import type { MediaItem } from '../types'

const MB = 1024 * 1024
const IMAGE_MAX = 10 * MB
const OTHER_MAX = 50 * MB

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * MB) return `${(bytes / MB).toFixed(1)} MB`
  return `${(bytes / 1024 / MB).toFixed(2)} GB`
}

function mediaTypeLabel(mediaType?: string): string {
  if (mediaType === 'image') return 'Image'
  if (mediaType === 'video') return 'Video'
  if (mediaType === 'file') return 'File'
  return 'Media'
}

function clientSizeError(file: File): string | null {
  const isImage = (file.type || '').startsWith('image/')
  const limit = isImage ? IMAGE_MAX : OTHER_MAX
  if (file.size > limit) {
    return `This ${isImage ? 'image' : 'file'} is ${formatBytes(file.size)}, which exceeds Telegram's ${isImage ? '10 MB' : '50 MB'} upload limit.`
  }
  return null
}

export function StudioScreen(): React.JSX.Element {
  const { openPlayer, notify } = useApp()
  const studio = useStudioMedia()
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminChecked, setAdminChecked] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)

  // Upload panel state
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void studioApi.session().then((admin) => {
      setIsAdmin(admin)
      setAdminChecked(true)
    })
  }, [])

  const handleLogin = useCallback(async () => {
    setLoggingIn(true)
    setLoginError(null)
    try {
      const ok = await studioApi.login(password)
      if (ok) {
        setIsAdmin(true)
        setShowLogin(false)
        setPassword('')
        notify('Signed in as admin', 'success')
        void studio.reload()
      } else {
        setLoginError('Incorrect admin password.')
      }
    } catch (reason) {
      setLoginError(reason instanceof Error ? reason.message : 'Sign-in failed.')
    } finally {
      setLoggingIn(false)
    }
  }, [password, notify, studio])

  const handleLogout = useCallback(async () => {
    await studioApi.logout().catch(() => undefined)
    setIsAdmin(false)
    notify('Signed out')
  }, [notify])

  const resetUploadForm = useCallback(() => {
    setFile(null)
    setTitle('')
    setCaption('')
    setProgress(0)
    setUploadError(null)
    setUploadSuccess(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleUpload = useCallback(async () => {
    if (!file || uploading) return
    const sizeError = clientSizeError(file)
    if (sizeError) {
      setUploadError(sizeError)
      return
    }
    setUploading(true)
    setProgress(0)
    setUploadError(null)
    setUploadSuccess(null)
    try {
      const item = await studioApi.uploadMedia(file, {
        title: title.trim(),
        caption: caption.trim(),
        onProgress: setProgress
      })
      setUploadSuccess(`Uploaded ${item.fileName}`)
      notify('Media uploaded to secure storage', 'success')
      resetUploadForm()
      void studio.reload()
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }, [file, uploading, title, caption, notify, resetUploadForm, studio])

  const handleDelete = useCallback(async (item: MediaItem) => {
    if (!window.confirm(`Delete "${item.fileName || item.title}"? This removes it from storage and the app.`)) return
    try {
      await studioApi.deleteMedia(item.id)
      notify('Media deleted', 'success')
      void studio.reload()
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Delete failed.', 'error')
    }
  }, [notify, studio])

  const clearFile = useCallback(() => {
    setFile(null)
    setUploadError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const visibleItems = useMemo(() => studio.items, [studio.items])

  return (
    <section className="screen">
      <ScreenHeader
        title="Studio"
        eyebrow="Private media storage"
        actions={
          adminChecked && isAdmin ? (
            <button className="round-button" type="button" onClick={() => void handleLogout()} aria-label="Sign out admin">
              <LogOutIcon size={18} />
            </button>
          ) : (
            <span className="count-badge">{studio.items.length}</span>
          )
        }
      />

      <div className="studio-intro">
        <span className="studio-intro__icon"><StudioIcon size={22} /></span>
        <div>
          <h2>Your media library.</h2>
          <p>Uploaded clips live in private storage and appear here automatically. Only you can upload.</p>
        </div>
      </div>

      {/* Admin-only upload + management panel */}
      {adminChecked && isAdmin && (
        <div className="admin-panel">
          <div className="section-heading"><div><p className="eyebrow">Admin</p><h3>Upload media</h3></div></div>
          <p className="form-help">Delivered to your private storage channel. The storage token stays server-side and is never sent to the app or normal users.</p>

          <div className="upload-card">
            <input
              ref={fileInputRef}
              id="studio-file"
              type="file"
              accept="image/*,video/*,application/pdf,text/plain,.zip,.rar,.7z,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
              className="sr-only"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null
                setFile(selected)
                setUploadError(null)
                setUploadSuccess(null)
              }}
            />
            <label htmlFor="studio-file" className={`upload-drop${file ? ' is-filled' : ''}`}>
              <UploadIcon size={22} />
              <strong>{file ? file.name : 'Choose an image, video, or file'}</strong>
              <span>{file ? formatBytes(file.size) : 'Images up to 10 MB · videos & files up to 50 MB'}</span>
            </label>

            {file && (
              <div className="upload-meta">
                <button className="text-button" type="button" onClick={clearFile}>Clear</button>
                <span>{mediaTypeLabel(file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file')}</span>
              </div>
            )}

            <div className="upload-fields">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Title (optional)"
                aria-label="Title"
                maxLength={120}
              />
              <input
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                placeholder="Caption (optional)"
                aria-label="Caption"
                maxLength={200}
              />
            </div>

            {uploading && (
              <div className="upload-progress">
                <div className="upload-progress__bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                <span>{Math.round(progress * 100)}%{progress >= 1 ? ' · finalizing…' : ''}</span>
              </div>
            )}

            {uploadError && <div className="upload-note upload-note--error">{uploadError}</div>}
            {uploadSuccess && <div className="upload-note upload-note--success"><CheckIcon size={14} /> {uploadSuccess}</div>}

            <div className="upload-actions">
              <button className="primary-button" type="button" onClick={() => void handleUpload()} disabled={!file || uploading}>
                {uploading ? 'Uploading…' : 'Upload to storage'}
              </button>
              {uploadError && file && (
                <button className="secondary-button" type="button" onClick={() => void handleUpload()} disabled={uploading}>
                  Retry
                </button>
              )}
            </div>
          </div>

          {studio.items.length > 0 && (
            <>
              <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Manage</p><h3>Stored media</h3></div><span>{studio.items.length}</span></div>
              <div className="admin-media-list">
                {studio.items.map((item) => (
                  <div className="admin-media-row" key={item.id}>
                    <button
                      className="admin-media-row__thumb"
                      type="button"
                      onClick={() => openPlayer(item)}
                      aria-label={`Open ${item.fileName || item.title}`}
                    >
                      {item.mediaType === 'file' ? (
                        <DownloadIcon size={18} />
                      ) : (
                        <img src={item.thumbnail} alt="" loading="lazy" />
                      )}
                    </button>
                    <div className="admin-media-row__copy">
                      <strong>{item.fileName || item.title}</strong>
                      <small>{mediaTypeLabel(item.mediaType)} · {formatBytes(item.fileSize ?? 0)}{item.duration ? ` · ${Math.round(item.duration)}s` : ''} · {new Date(item.createdAt).toLocaleDateString()}</small>
                    </div>
                    <button className="admin-media-row__delete" type="button" onClick={() => void handleDelete(item)} aria-label="Delete media">
                      <TrashIcon size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Non-admin: offer sign-in (Telegram / storage details never shown) */}
      {adminChecked && !isAdmin && (
        <div className="admin-signin">
          {showLogin ? (
            <div className="admin-signin__form">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Admin password"
                aria-label="Admin password"
                autoFocus
                onKeyDown={(event) => { if (event.key === 'Enter') void handleLogin() }}
              />
              <button className="primary-button" type="button" onClick={() => void handleLogin()} disabled={loggingIn || !password}>
                {loggingIn ? 'Signing in…' : 'Sign in'}
              </button>
              <button className="text-button" type="button" onClick={() => { setShowLogin(false); setLoginError(null) }}>Cancel</button>
              {loginError && <div className="upload-note upload-note--error">{loginError}</div>}
            </div>
          ) : (
            <button className="secondary-button" type="button" onClick={() => setShowLogin(true)}>
              <StudioIcon size={18} /> Admin sign-in
            </button>
          )}
        </div>
      )}

      {/* Public media grid (visible to everyone) */}
      <div className="section-heading section-heading--spaced">
        <div><p className="eyebrow">In the app</p><h3>Uploaded media</h3></div>
        {!studio.loading && <span>{studio.items.length} items</span>}
      </div>

      {studio.error ? (
        <div className="live-error empty-state">
          <strong>Could not load media.</strong>
          <span>{studio.error}</span>
          <button className="secondary-button" type="button" onClick={() => void studio.reload()}><RefreshIcon size={16} /> Retry</button>
        </div>
      ) : (
        <MediaGrid
          items={visibleItems}
          loading={studio.loading}
          empty={
            <div className="empty-state">
              <span className="empty-state__icon"><StudioIcon size={25} /></span>
              <strong>No media yet.</strong>
              <span>When the admin uploads to private storage, it appears here automatically.</span>
            </div>
          }
        />
      )}
    </section>
  )
}
