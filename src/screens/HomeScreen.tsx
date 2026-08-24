import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LiveError } from '../components/LiveState'
import { PlayIcon } from '../components/icons'
import { PullToRefresh } from '../components/PullToRefresh'
import { ScreenHeader } from '../components/ScreenHeader'
import { useApp } from '../context/AppContext'
import { hotpicApi, type HotpicAlbumCard } from '../lib/hotpic'

export function HomeScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { account, openPlayer } = useApp()
  const [cards, setCards] = useState<HotpicAlbumCard[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [canLoadMore, setCanLoadMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const merge = (current: HotpicAlbumCard[], next: HotpicAlbumCard[]) => [
    ...current,
    ...next.filter((card) => !current.some((entry) => entry.id === card.id && (entry.kind || 'album') === (card.kind || 'album')))
  ]

  const load = async (nextPage: number, append: boolean) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const feed = await hotpicApi.feed('Desi', nextPage)
      const batch = [...feed.albums, ...feed.pics, ...feed.videos]
      setCards((current) => append ? merge(current, batch) : batch)
      setPage(nextPage)
      setCanLoadMore(batch.length > 0)
    } catch (reason) {
      if (!append) setError(reason instanceof Error ? reason.message : 'Hotpic Desi could not load.')
      setCanLoadMore(false)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => { void load(1, false) }, [])

  useEffect(() => {
    if (!canLoadMore || loading || loadingMore || !sentinelRef.current || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void load(page + 1, true)
    }, { rootMargin: '420px 0px' })
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [canLoadMore, loading, loadingMore, page])

  const openCard = (card: HotpicAlbumCard) => {
    if ((card.kind || 'album') === 'album') {
      navigate(`/hotpic/${card.id}`)
      return
    }
    const item = hotpicApi.cardToMedia(card)
    const queue = cards.filter((entry) => entry.kind === card.kind).map(hotpicApi.cardToMedia)
    openPlayer(item, queue.length ? queue : [item])
  }

  return (
    <PullToRefresh onRefresh={async () => { await load(1, false) }}>
      <section className="screen screen--home">
        <ScreenHeader showMark title="X-sutra" actions={
          <div className="home-header-actions">
            <button className="home-cta home-cta--premium" type="button" onClick={() => navigate('/premium')}>✦ Premium</button>
            <button className="home-cta home-cta--login" type="button" onClick={() => navigate(account ? (account.role === 'admin' ? '/admin' : '/you') : '/login')}>{account ? (account.role === 'admin' ? 'Admin' : `@${account.username}`) : 'Login'}</button>
          </div>
        } />

        <div className="section-heading">
          <div><p className="eyebrow">Hotpic</p><h3>Desi</h3></div>
          {!loading && <span>{cards.length} loaded</span>}
        </div>

        {error && <LiveError message={error} onRetry={() => void load(1, false)} />}
        {loading && <div className="hp-grid">{Array.from({ length: 8 }, (_, index) => <div className="media-skeleton" key={index} />)}</div>}
        {!loading && cards.length === 0 && !error && <div className="empty-state"><strong>No public Hotpic Desi posts yet.</strong></div>}

        <div className="hp-grid">
          {cards.map((card) => (
            <button key={`${card.kind}-${card.id}`} className="hp-card" type="button" onClick={() => openCard(card)}>
              <span className="hp-card__media" style={card.cover ? { backgroundImage: `url(${card.cover})` } : undefined}>
                {(card.kind === 'video' || card.hasVideo) && <i className="hp-card__play"><PlayIcon size={18} /></i>}
              </span>
              <strong>{card.title}</strong>
              {card.owner && <small>@{card.owner}</small>}
            </button>
          ))}
        </div>
        {canLoadMore && <div className="feed-sentinel" ref={sentinelRef} aria-live="polite">{loadingMore ? <span className="feed-sentinel__loading">Loading more Desi…</span> : <span className="feed-sentinel__ready">Keep scrolling for more</span>}</div>}
        {canLoadMore && (
          <div className="load-more-wrap">
            <button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void load(page + 1, true)}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </section>
    </PullToRefresh>
  )
}
