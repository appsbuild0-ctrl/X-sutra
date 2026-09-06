import { useEffect, useMemo, useRef } from 'react'
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

/** Real-feed grid with an observer sentinel for smooth infinite paging. */
export function MediaGrid({ items, loading = false, empty, canLoadMore = false, loadingMore = false, onLoadMore }: MediaGridProps): React.JSX.Element {
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Some feeds mix sources that overlap (the For You feed merges trending +
  // latest pages, creator feeds merge into the home list). Duplicate ids used
  // to reach React as duplicate keys, which remounted whole cards mid-scroll —
  // images reloaded, video previews restarted, and the grid visibly blinked.
  const uniqueItems = useMemo(() => {
    if (items.length < 2) return items
    const seen = new Set<string>()
    return items.filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
  }, [items])

  useEffect(() => {
    if (!canLoadMore || loadingMore || !onLoadMore || !sentinelRef.current || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
    }, { rootMargin: '600px 0px' })
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [canLoadMore, loadingMore, onLoadMore, uniqueItems.length])

  if (loading) {
    return <div className="media-grid" aria-label="Loading public media">{Array.from({ length: 8 }, (_, index) => <div className="media-skeleton" key={index} />)}</div>
  }
  if (!uniqueItems.length) return <>{empty}</>

  return (
    <>
      <div className="media-grid">{uniqueItems.map((item, index) => <MediaCard key={item.id} item={item} queue={uniqueItems} priority={index < 4} />)}</div>
      {canLoadMore && <div className="feed-sentinel" ref={sentinelRef} aria-live="polite">{loadingMore && <span className="feed-sentinel__loading">Loading more…</span>}</div>}
    </>
  )
}
