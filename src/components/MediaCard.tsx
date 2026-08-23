import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  const navigate = useNavigate()
  const [imageFailed, setImageFailed] = useState(false)
  const saved = isSaved(item.id)
  const showImage = Boolean(item.thumbnail) && !imageFailed

  return (
    <article className="media-card">
      <button
        className={`media-card__visual${showImage ? '' : ' media-card__visual--empty'}`}
        type="button"
        onClick={() => openPlayer(item)}
        aria-label={`Open ${item.title}`}
      >
        {showImage ? (
          <img src={item.thumbnail} alt="" loading={priority ? 'eager' : 'lazy'} onError={() => setImageFailed(true)} />
        ) : (
          <span className="media-card__missing">No public preview</span>
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
