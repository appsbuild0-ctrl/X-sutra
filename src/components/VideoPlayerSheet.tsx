import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { compactNumber } from '../lib/format'
import { BookmarkIcon, CloseIcon, DownloadIcon, ExternalIcon } from './icons'

export function VideoPlayerSheet(): React.JSX.Element | null {
  const {
    activeMedia,
    closePlayer,
    isSaved,
    toggleSaved,
    requestDownload,
    preferences,
    collections,
    addToCollection
  } = useApp()
  const navigate = useNavigate()
  const [collectionId, setCollectionId] = useState('')

  useEffect(() => {
    if (!activeMedia) return
    setCollectionId('')
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePlayer()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeMedia, closePlayer])

  if (!activeMedia) return null

  const saved = isSaved(activeMedia.id)
  const source = activeMedia.videoUrl ?? activeMedia.videoUrlSd
  const openRoute = (path: string) => {
    closePlayer()
    navigate(path)
  }

  return (
    <div className="player-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closePlayer()
    }}>
      <section className="player-sheet" role="dialog" aria-modal="true" aria-label={`Player for ${activeMedia.title}`}>
        <header className="player-sheet__topbar">
          <span className="player-sheet__brand">X-sutra <i>•</i> Public player</span>
          <button className="round-button round-button--dark" type="button" onClick={closePlayer} aria-label="Close player"><CloseIcon size={20} /></button>
        </header>

        <div className="player-stage">
          {source ? (
            <video
              key={activeMedia.id}
              src={source}
              poster={activeMedia.thumbnail}
              controls
              autoPlay={preferences.autoplay}
              muted={preferences.muted}
              playsInline
              preload="metadata"
            >
              Your device cannot play this public video.
            </video>
          ) : (
            <div className="player-stage__placeholder">
              <span>Unavailable</span>
              <strong>This public item does not expose a playable video URL.</strong>
            </div>
          )}
        </div>

        <div className="player-sheet__body">
          <div className="player-sheet__headline">
            <div>
              <button className="player-creator-link" type="button" onClick={() => openRoute(`/creator/${encodeURIComponent(activeMedia.creator)}`)}>@{activeMedia.creator}</button>
              <h2>{activeMedia.title}</h2>
              <p className="player-sheet__stats">{compactNumber(activeMedia.views)} views <span>·</span> {compactNumber(activeMedia.likes)} likes</p>
            </div>
            <button
              className={`save-button save-button--large${saved ? ' is-saved' : ''}`}
              type="button"
              onClick={() => toggleSaved(activeMedia)}
              aria-label={saved ? 'Remove from library' : 'Save to library'}
            >
              <BookmarkIcon filled={saved} size={20} />
            </button>
          </div>

          {activeMedia.description && activeMedia.description !== activeMedia.title && <p className="player-description">{activeMedia.description}</p>}

          {activeMedia.tags.length > 0 && (
            <div className="tag-row" aria-label="Tags">
              {activeMedia.tags.slice(0, 10).map((tag) => (
                <button className="tag tag--button" type="button" key={tag} onClick={() => openRoute(`/tag/${encodeURIComponent(tag)}`)}>#{tag}</button>
              ))}
            </div>
          )}

          {activeMedia.niches.length > 0 && (
            <div className="niche-link-row">
              {activeMedia.niches.slice(0, 4).map((niche) => <button key={niche} type="button" onClick={() => openRoute(`/niche/${encodeURIComponent(niche)}`)}>Explore {niche}</button>)}
            </div>
          )}

          {collections.length > 0 && (
            <div className="collection-adder">
              <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)} aria-label="Choose local collection">
                <option value="">Add to collection…</option>
                {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
              </select>
              <button className="secondary-button" type="button" disabled={!collectionId} onClick={() => {
                if (collectionId) addToCollection(collectionId, activeMedia)
                setCollectionId('')
              }}>Add</button>
            </div>
          )}

          <div className="player-sheet__actions">
            <button className="primary-button" type="button" onClick={() => void requestDownload(activeMedia)} disabled={!source}>
              <DownloadIcon size={19} /> Download
            </button>
            <a className="secondary-button" href={activeMedia.sourceUrl} target="_blank" rel="noreferrer">
              <ExternalIcon size={18} /> Open source
            </a>
          </div>
          <p className="player-sheet__note">This player uses the public source URL. Save, collection, and download history stay on this device.</p>
        </div>
      </section>
    </div>
  )
}
