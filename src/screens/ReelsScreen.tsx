import { useCallback } from 'react'
import { LiveError } from '../components/LiveState'
import { MediaGrid } from '../components/MediaGrid'
import { PullToRefresh } from '../components/PullToRefresh'
import { ScreenHeader } from '../components/ScreenHeader'
import { usePagedMedia } from '../hooks/usePagedMedia'
import { publicMediaApi } from '../lib/redgifs'

export function ReelsScreen(): React.JSX.Element {
  const feed = usePagedMedia(useCallback((page: number) => publicMediaApi.tag('desi', page, 'latest'), []), [])

  return (
    <PullToRefresh onRefresh={feed.reload}>
      <section className="screen">
        <ScreenHeader showMark title="Reels" />
        <div className="section-heading">
          <div><p className="eyebrow">RedGifs</p><h3>Desi</h3></div>
          {!feed.loading && <span>{feed.items.length} loaded</span>}
        </div>
        {feed.error
          ? <LiveError message={feed.error} onRetry={feed.reload} title="Desi reels could not load." />
          : <MediaGrid twoColumn items={feed.items} loading={feed.loading} canLoadMore={feed.canLoadMore} loadingMore={feed.loadingMore} onLoadMore={() => void feed.loadMore()} empty={<div className="empty-state"><strong>No public Desi reels right now.</strong></div>} />}
      </section>
    </PullToRefresh>
  )
}
