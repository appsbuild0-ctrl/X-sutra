import { useState } from 'react'
import { compactNumber, durationLabel } from '../lib/format'
import type { MediaItem } from '../types'
import { useApp } from '../context/AppContext'
import { BookmarkIcon, PlayIcon } from './icons'

interface MediaCardProps {
  item: MediaItem
  priority?: boolean
}

export function MediaCard({ item, priority = false }: MediaCardProps): React.JSX.Element {
  const { isSaved, openPlayer, toggleSaved } = useApp()
  const [imageFailed, setImageFailed] = useState(false)
  const saved = isSaved(item.id)
  const showImage = Boolean(item.thumbnail) && !imageFailed

  return (
    <article className="media-card">
      <button
        className="media-card__visual"
        type="button"
        onClick={() => openPlayer(item)}
        aria-label={`Play ${item.title}`}
        style={!showImage ? { background: item.gradient } : undefined}
      >
        {showImage && (
          <img
            src={item.thumbnail}
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            onError={() => setImageFailed(true)}
          />
        )}
        {!showImage && <span className="media-card__art" aria-hidden="true"><i /><i /><i /></span>}
        <span className="media-card__shade" aria-hidden="true" />
        <span className="media-card__play" aria-hidden="true"><PlayIcon size={18} /></span>
        <span className="media-card__duration">{durationLabel(item.duration)}</span>
        {item.isDemo && <span className="media-card__demo">Preview</span>}
      </button>

      <div className="media-card__info">
        <button className="media-card__copy" type="button" onClick={() => openPlayer(item)}>
          <span className="media-card__title">{item.title}</span>
          <span className="media-card__creator">@{item.creator}</span>
        </button>
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
