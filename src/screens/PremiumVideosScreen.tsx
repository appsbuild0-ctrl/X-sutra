import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { LiveError } from '../components/LiveState'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { usePagedMedia } from '../hooks/usePagedMedia'
import { publicMediaApi } from '../lib/redgifs'

export function PremiumVideosScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const feed = usePagedMedia(useCallback((page: number) => publicMediaApi.tag('desi', page, 'latest'), []), [])

  return (
    <section className="screen screen--ott">
      <ScreenHeader title="Desi videos" eyebrow="RedGifs · public" actions={<button className="round-button" type="button" onClick={() => navigate('/premium')} aria-label="Back">‹</button>} />
      {feed.error
        ? <LiveError message={feed.error} onRetry={feed.reload} title="Desi videos could not load." />
        : <MediaGrid items={feed.items} loading={feed.loading} canLoadMore={feed.canLoadMore} loadingMore={feed.loadingMore} onLoadMore={() => void feed.loadMore()} empty={<div className="empty-state"><strong>No public Desi clips right now.</strong></div>} />}
    </section>
  )
}
