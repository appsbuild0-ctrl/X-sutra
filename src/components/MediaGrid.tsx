import { useEffect, useRef } from 'react'
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
  twoColumn?: boolean
}

/** Real-feed grid with an observer sentinel for smooth infinite paging. */
export function MediaGrid({ items, loading = false, empty, canLoadMore = false, loadingMore = false, onLoadMore, twoColumn = false }: MediaGridProps): React.JSX.Element {
  const gridClass = twoColumn ? 'media-grid media-grid--two' : 'media-grid'
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!canLoadMore || loadingMore || !onLoadMore || !sentinelRef.current || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
    }, { rootMargin: '360px 0px' })
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [canLoadMore, loadingMore, onLoadMore, items.length])

  if (loading) {
    return <div className={gridClass} aria-label="Loading public media">{Array.from({ length: 8 }, (_, index) => <div className="media-skeleton" key={index} />)}</div>
  }
  if (!items.length) return <>{empty}</>

  return (
    <>
      <div className={gridClass}>{items.map((item, index) => <MediaCard key={item.id} item={item} queue={items} priority={index < 4} />)}</div>
      {canLoadMore && <div className="feed-sentinel" ref={sentinelRef} aria-live="polite">{loadingMore ? <span className="feed-sentinel__loading">Loading more real clips…</span> : <span className="feed-sentinel__ready">Keep scrolling for more</span>}</div>}
      {canLoadMore && onLoadMore && <div className="load-more-wrap"><button className="secondary-button" type="button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button></div>}
    </>
  )
}
