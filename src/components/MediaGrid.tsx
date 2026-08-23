import type { ReactNode } from 'react'
import type { MediaItem } from '../types'
import { MediaCard } from './MediaCard'

interface MediaGridProps {
  items: MediaItem[]
  loading?: boolean
  empty?: ReactNode
}

export function MediaGrid({ items, loading = false, empty }: MediaGridProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="media-grid" aria-label="Loading media">
        {Array.from({ length: 8 }, (_, index) => <div className="media-skeleton" key={index} />)}
      </div>
    )
  }

  if (!items.length) return <>{empty}</>

  return (
    <div className="media-grid">
      {items.map((item, index) => <MediaCard key={item.id} item={item} priority={index < 4} />)}
    </div>
  )
}
