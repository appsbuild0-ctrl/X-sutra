import type { ReactNode } from 'react'
import type { MediaItem } from '../types'
import { MediaCard } from './MediaCard'

interface MediaGridProps {
  items: MediaItem[]
  loading?: boolean
  empty?: ReactNode
  canLoadMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
}

export function MediaGrid({ items, loading = false, empty, canLoadMore = false, loadingMore = false, onLoadMore }: MediaGridProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="media-grid" aria-label="Loading public media">
        {Array.from({ length: 8 }, (_, index) => <div className="media-skeleton" key={index} />)}
      </div>
    )
  }

  if (!items.length) return <>{empty}</>

  return (
    <>
      <div className="media-grid">
        {items.map((item, index) => <MediaCard key={item.id} item={item} priority={index < 4} />)}
      </div>
      {canLoadMore && onLoadMore && (
        <div className="load-more-wrap">
          <button className="secondary-button" type="button" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading more…' : 'Load more public clips'}
          </button>
        </div>
      )}
    </>
  )
}
