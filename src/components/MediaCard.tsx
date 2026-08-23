import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { compactNumber, durationLabel } from '../lib/format'
import type { MediaItem } from '../types'
import { useApp } from '../context/AppContext'
import { BookmarkIcon, PlayIcon } from './icons'

interface MediaCardProps {
  item: MediaItem
  priority?: boolean
}

/** Real-media card with ordered source fallback instead of a generated placeholder. */
export function MediaCard({ item, priority = false }: MediaCardProps): React.JSX.Element {
  const { isSaved, openPlayer, toggleSaved } = useApp()
  const navigate = useNavigate()
  const [thumbnailIndex, setThumbnailIndex] = useState(0)
  const [imageExhausted, setImageExhausted] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const saved = isSaved(item.id)

  const thumbnails = useMemo(() => {
    const candidates = item.thumbnailUrls?.length ? item.thumbnailUrls : (item.thumbnail ? [item.thumbnail] : [])
    return [...new Set(candidates.filter(Boolean))]
  }, [item.thumbnail, item.thumbnailUrls])
  const activeThumbnail = !imageExhausted ? thumbnails[thumbnailIndex] : undefined
  const previewSource = item.previewUrl ?? item.videoUrlSd ?? item.videoUrl

  useEffect(() => {
    setThumbnailIndex(0)
    setImageExhausted(false)
    setPreviewFailed(false)
  }, [item.id])

  const nextThumbnail = () => {
    if (thumbnailIndex + 1 < thumbnails.length) setThumbnailIndex((current) => current + 1)
    else setImageExhausted(true)
  }

  return (
    <article className="media-card">
      <button
        className={`media-card__visual${activeThumbnail || (previewSource && !previewFailed) ? '' : ' media-card__visual--empty'}`}
        type="button"
        onClick={() => openPlayer(item)}
        aria-label={`Open ${item.title}`}
      >
        {activeThumbnail ? (
          <img
            key={activeThumbnail}
            src={activeThumbnail}
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            referrerPolicy="no-referrer"
            onError={nextThumbnail}
          />
        ) : previewSource && !previewFailed ? (
          <video
            key={previewSource}
            src={previewSource}
            muted
            autoPlay
            loop
            playsInline
            preload="metadata"
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <span className="media-card__missing">Source preview unavailable</span>
        )}
        <span className="media-card__shade" aria-hidden="true" />
        <span className="media-card__play" aria-hidden="true"><PlayIcon size={18} /></span>
        <span className="media-card__duration">{durationLabel(item.duration)}</span>
        {item.hasAudio && <span className="media-card__audio">Audio</span>}
      </button>

      <div className="media-card__info">
        <div className="media-card__copy">
          <button className="media-card__title" type="button" onClick={() => openPlayer(item)}>{item.title}</button>
          <button className="media-card__creator" type="button" onClick={() => navigate(`/creator/${encodeURIComponent(item.creator)}`)}>@{item.creator}</button>
        </div>
        <button
          className={`save-button${saved ? ' is-saved' : ''}`}
          type="button"
          aria-label={saved ? `Remove ${item.title} from library` : `Save ${item.title} to library`}
          onClick={() => toggleSaved(item)}
        >
          <BookmarkIcon size={17} filled={saved} />
        </button>
      </div>
      <div className="media-card__meta">
        <span>{compactNumber(item.views)} views</span>
        <span>{compactNumber(item.likes)} likes</span>
      </div>
    </article>
  )
}
