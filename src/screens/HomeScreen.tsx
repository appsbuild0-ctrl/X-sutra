import { useCallback, useMemo, useState } from 'react'
import { LiveError, ScreenNotice } from '../components/LiveState'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { RefreshIcon, SparkIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { usePagedMedia } from '../hooks/usePagedMedia'
import { publicMediaApi } from '../lib/redgifs'
import type { FeedMode, FeedOrder } from '../types'

export function HomeScreen(): React.JSX.Element {
  const { preferences } = useApp()
  const [mode, setMode] = useState<FeedMode>('trending')
  const [order, setOrder] = useState<FeedOrder>('latest')

  const loadFeed = useCallback((page: number) => {
    return mode === 'trending' ? publicMediaApi.trending(page) : publicMediaApi.latest(page, order)
  }, [mode, order])
  const feed = usePagedMedia(loadFeed, [mode, order])

  const visibleItems = useMemo(() => {
    const blocked = new Set(preferences.blockedTags.map((tag) => tag.toLowerCase()))
    return feed.items.filter((item) => !item.tags.some((tag) => blocked.has(tag.toLowerCase())))
  }, [feed.items, preferences.blockedTags])

  return (
    <section className="screen screen--home">
      <ScreenHeader
        title="X-sutra"
        eyebrow="Public media browser"
        actions={<button className="round-button" type="button" onClick={() => void feed.reload()} aria-label="Refresh live feed"><RefreshIcon size={20} /></button>}
      />

      <div className="home-intro">
        <div>
          <p className="home-intro__kicker"><SparkIcon size={16} /> Real public feed</p>
          <h2>{mode === 'trending' ? 'What’s moving now.' : 'Newest public clips.'}</h2>
          <p>Live public data, playable source previews, and local-only saves. No account sign-in is required.</p>
        </div>
        <span className="live-pill"><i /> Live V2</span>
      </div>

      <div className="feed-toolbar">
        <div className="segmented" role="tablist" aria-label="Feed selection">
          <button className={mode === 'latest' ? 'is-active' : ''} type="button" role="tab" aria-selected={mode === 'latest'} onClick={() => setMode('latest')}>Latest</button>
          <button className={mode === 'trending' ? 'is-active' : ''} type="button" role="tab" aria-selected={mode === 'trending'} onClick={() => setMode('trending')}>Trending</button>
        </div>
        <label className="sort-control">
          <span className="sr-only">Sort public feed</span>
          <select value={order} disabled={mode === 'trending'} onChange={(event) => setOrder(event.target.value as FeedOrder)}>
            <option value="latest">Latest</option>
            <option value="best">Best</option>
            <option value="top">Top</option>
            <option value="trending">Trending</option>
          </select>
        </label>
      </div>

      {preferences.blockedTags.length > 0 && <ScreenNotice>{preferences.blockedTags.length} blocked tag{preferences.blockedTags.length === 1 ? '' : 's'} are hidden from this live feed.</ScreenNotice>}

      <div className="section-heading">
        <div>
          <p className="eyebrow">{mode === 'trending' ? 'Public feed' : 'Public search index'}</p>
          <h3>{mode === 'trending' ? 'Trending now' : 'Latest clips'}</h3>
        </div>
        {!feed.loading && <span>{visibleItems.length} loaded</span>}
      </div>

      {feed.error ? (
        <LiveError message={feed.error} onRetry={feed.reload} />
      ) : (
        <MediaGrid
          items={visibleItems}
          loading={feed.loading}
          canLoadMore={feed.canLoadMore}
          loadingMore={feed.loadingMore}
          onLoadMore={() => void feed.loadMore()}
          empty={<div className="empty-state"><strong>No public clips matched.</strong><span>Change the feed or review blocked tags in Settings.</span></div>}
        />
      )}
    </section>
  )
}
