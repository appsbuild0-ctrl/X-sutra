import { useCallback, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LiveError } from '../components/LiveState'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { ArrowLeftIcon, RefreshIcon } from '../components/icons'
import { usePagedMedia } from '../hooks/usePagedMedia'
import { publicMediaApi } from '../lib/redgifs'
import type { FeedOrder } from '../types'

export function TagScreen(): React.JSX.Element {
  const { tag: encodedTag = '' } = useParams()
  const tag = decodeURIComponent(encodedTag)
  const navigate = useNavigate()
  const [order, setOrder] = useState<FeedOrder>('latest')
  const feed = usePagedMedia(useCallback((page: number) => publicMediaApi.tag(tag, page, order), [tag, order]), [tag, order])

  return (
    <section className="screen">
      <ScreenHeader title={`#${tag}`} eyebrow="Public tag search" actions={<><button className="round-button" type="button" onClick={() => void feed.reload()} aria-label="Refresh tag"><RefreshIcon size={19} /></button><button className="round-button" type="button" onClick={() => navigate(-1)} aria-label="Go back"><ArrowLeftIcon size={19} /></button></>} />
      <div className="feed-toolbar">
        <div className="section-heading section-heading--inline"><div><p className="eyebrow">Tag feed</p><h3>Live results</h3></div></div>
        <label className="sort-control"><span className="sr-only">Sort tag results</span><select value={order} onChange={(event) => setOrder(event.target.value as FeedOrder)}><option value="latest">Latest</option><option value="best">Best</option><option value="top">Top</option></select></label>
      </div>
      {feed.error ? <LiveError message={feed.error} onRetry={feed.reload} title="Tag search could not load." /> : <MediaGrid items={feed.items} loading={feed.loading} canLoadMore={feed.canLoadMore} loadingMore={feed.loadingMore} onLoadMore={() => void feed.loadMore()} empty={<div className="empty-state"><strong>No public clips found for this tag.</strong></div>} />}
    </section>
  )
}
