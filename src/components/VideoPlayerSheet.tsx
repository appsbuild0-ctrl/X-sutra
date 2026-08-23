import { useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { compactNumber } from '../lib/format'
import { BookmarkIcon, CloseIcon, DownloadIcon, ExternalIcon } from './icons'

export function VideoPlayerSheet(): React.JSX.Element | null {
  const { activeMedia, closePlayer, isSaved, toggleSaved, requestDownload, preferences } = useApp()

  useEffect(() => {
    if (!activeMedia) return
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

  return (
    <div className="player-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closePlayer()
    }}>
      <section className="player-sheet" role="dialog" aria-modal="true" aria-label={`Player for ${activeMedia.title}`}>
        <header className="player-sheet__topbar">
          <span className="player-sheet__brand">X-sutra <i>•</i> Now playing</span>
          <button className="round-button round-button--dark" type="button" onClick={closePlayer} aria-label="Close player"><CloseIcon size={20} /></button>
        </header>

        <div className="player-stage" style={!source ? { background: activeMedia.gradient } : undefined}>
          {source ? (
            <video
              key={activeMedia.id}
              src={source}
              poster={activeMedia.thumbnail}
              controls
              autoPlay={preferences.autoplay}
              playsInline
              preload="metadata"
            >
              Your device cannot play this video.
            </video>
          ) : (
            <div className="player-stage__placeholder">
              <span>Preview</span>
              <strong>This local preview has no remote video file.</strong>
            </div>
          )}
        </div>

        <div className="player-sheet__body">
          <div className="player-sheet__headline">
            <div>
              <p className="eyebrow">@{activeMedia.creator}</p>
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

          {activeMedia.tags.length > 0 && (
            <div className="tag-row" aria-label="Tags">
              {activeMedia.tags.slice(0, 6).map((tag) => <span className="tag" key={tag}>#{tag}</span>)}
            </div>
          )}

          <div className="player-sheet__actions">
            <button className="primary-button" type="button" onClick={() => void requestDownload(activeMedia)} disabled={!source}>
              <DownloadIcon size={19} /> Download
            </button>
            {activeMedia.sourceUrl && (
              <a className="secondary-button" href={activeMedia.sourceUrl} target="_blank" rel="noreferrer">
                <ExternalIcon size={18} /> Open source
              </a>
            )}
          </div>
          <p className="player-sheet__note">Saves stay on this device. Public files are downloaded in your chosen quality.</p>
        </div>
      </section>
    </div>
  )
}
