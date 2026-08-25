import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CreatorAvatar } from '../components/CreatorAvatar'
import { LiveError } from '../components/LiveState'
import { PayQrModal, PlanCards, type PlanId } from '../components/PlanPay'
import { MediaGrid } from '../components/MediaGrid'
import { PlayIcon, SearchIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { usePagedMedia } from '../hooks/usePagedMedia'
import { hotpicApi, type HotpicAlbumCard } from '../lib/hotpic'
import { publicMediaApi } from '../lib/redgifs'
import { hasPremiumAccess, roleLabel } from '../lib/roles'
import type { Creator } from '../types'

function CardGrid({ cards, onOpen }: { cards: HotpicAlbumCard[]; onOpen: (card: HotpicAlbumCard) => void }): React.JSX.Element | null {
  if (!cards.length) return null
  return (
    <div className="hp-grid">
      {cards.map((card) => (
        <button key={`${card.kind}-${card.id}`} className="hp-card" type="button" onClick={() => onOpen(card)}>
          <span className="hp-card__media" style={card.cover ? { backgroundImage: `url(${card.cover})` } : undefined}>
            {(card.kind === 'video' || card.hasVideo) && <i className="hp-card__play"><PlayIcon size={18} /></i>}
          </span>
          <strong>{card.title}</strong>
          {card.owner && <small>@{card.owner}</small>}
        </button>
      ))}
    </div>
  )
}

function PremiumContent(): React.JSX.Element {
  const navigate = useNavigate()
  const { openPlayer } = useApp()
  const [models, setModels] = useState<Creator[]>([])
  const [albums, setAlbums] = useState<HotpicAlbumCard[]>([])
  const [pics, setPics] = useState<HotpicAlbumCard[]>([])
  const [page, setPage] = useState(1)
  const desi = usePagedMedia(useCallback((nextPage: number) => publicMediaApi.tag('desi', nextPage, 'latest'), []), [])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const merge = (current: HotpicAlbumCard[], next: HotpicAlbumCard[]) => [
    ...current,
    ...next.filter((card) => !current.some((entry) => entry.id === card.id && entry.kind === card.kind))
  ]

  const load = async (nextPage: number, append: boolean) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const feed = await hotpicApi.feed('Desi', nextPage)
      if (!append) setModels(feed.users)
      setAlbums((current) => append ? merge(current, feed.albums) : feed.albums)
      setPics((current) => append ? merge(current, feed.pics) : feed.pics)
      setPage(nextPage)
    } catch (reason) {
      if (!append) {
        setModels(await hotpicApi.topModels())
        setError(reason instanceof Error ? reason.message : 'Hotpic feed could not load.')
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => { void load(1, false) }, [])

  const openCard = (card: HotpicAlbumCard) => {
    if (card.kind === 'album' || !card.kind) {
      navigate(`/premium/hotpic/${card.id}`)
      return
    }
    const item = hotpicApi.cardToMedia(card)
    const queue = pics.map(hotpicApi.cardToMedia)
    openPlayer(item, queue.length ? queue : [item])
  }

  return (
    <section className="screen screen--premium screen--ott">
      <form className="ott-search" onSubmit={(event) => { event.preventDefault(); navigate(`/premium/search${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`) }}>
        <SearchIcon size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Hotpic" aria-label="Search Hotpic" />
        <button className="ott-exit" type="button" onClick={() => navigate('/')}>Exit</button>
      </form>

      {error && <LiveError message={error} onRetry={() => void load(1, false)} />}

      <div className="ott-row-head"><h3>Accounts</h3></div>
      {models.length > 0 && (
        <div className="ott-rail ott-models" aria-label="Hotpic accounts">
          {models.map((model, index) => (
            <button key={model.username} className="ott-model" type="button" onClick={() => navigate(`/premium/model/${encodeURIComponent(model.username)}`)}>
              <CreatorAvatar src={model.avatar} label={model.displayName || model.username} index={index} className="ott-model__avatar" />
              <strong>{model.displayName || model.username}</strong>
              <small>@{model.username}</small>
            </button>
          ))}
        </div>
      )}

      {loading && <div className="media-grid">{Array.from({ length: 6 }, (_, index) => <div className="media-skeleton" key={index} />)}</div>}

      <div className="ott-row-head"><h3>Albums</h3></div>
      {!loading && albums.length === 0 && <p className="form-help">No public albums on this page.</p>}
      <CardGrid cards={albums} onOpen={openCard} />

      <div className="ott-row-head"><h3>Pics</h3></div>
      {!loading && pics.length === 0 && <p className="form-help">No public pics on this page.</p>}
      <CardGrid cards={pics} onOpen={openCard} />

      <div className="ott-row-head">
        <h3>Videos · RedGifs Desi</h3>
        <button type="button" onClick={() => navigate('/premium/videos')} aria-label="All Desi videos">›</button>
      </div>
      {desi.error
        ? <LiveError message={desi.error} onRetry={desi.reload} title="Desi videos could not load." />
        : <MediaGrid items={desi.items} loading={desi.loading} canLoadMore={desi.canLoadMore} loadingMore={desi.loadingMore} onLoadMore={() => void desi.loadMore()} empty={<div className="empty-state"><strong>No public Desi clips right now.</strong></div>} />}

      {(albums.length > 0 || pics.length > 0) && (
        <div className="load-more-wrap">
          <button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void load(page + 1, true)}>
            {loadingMore ? 'Loading…' : 'Load more albums & pics'}
          </button>
        </div>
      )}
    </section>
  )
}

export function PremiumScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { account } = useApp()
  const [plan, setPlan] = useState<PlanId | null>(null)

  if (hasPremiumAccess(account?.role)) return <PremiumContent />

  return (
    <section className="screen premium-gate-screen">
      <div className="premium-gate-hero">
        <button className="ott-exit" type="button" onClick={() => navigate('/')}>← Home</button>
        <span className="premium-gate-crown">⭐</span>
        <p className="eyebrow">X-Sutra membership</p>
        <h1>Unlock Premium</h1>
        <p>Private channels and protected media stay hidden until your account is activated by the server.</p>
        {account
          ? <span className="premium-status-chip">Current status · {roleLabel(account.role)}</span>
          : <button className="primary-button" type="button" onClick={() => navigate('/login')}>Login or create account</button>}
      </div>
      <div className="premium-benefits">
        <h2>Premium access includes</h2>
        <div className="premium-benefit-grid">
          <article><span>📡</span><strong>Private channels</strong><p>Access the X-Sutra channel inbox without exposing its private source.</p></article>
          <article><span>▶</span><strong>Built-in player</strong><p>Watch protected videos and albums directly inside X-Sutra.</p></article>
          <article><span>⌕</span><strong>Premium search</strong><p>Search channels, categories, titles and media types.</p></article>
          <article><span>💎</span><strong>VIP tier</strong><p>Higher-tier collections and exclusive releases when enabled.</p></article>
        </div>
      </div>
      <div className="premium-plan-section">
        <p className="eyebrow">Choose your access</p>
        <h2>Premium & VIP plans</h2>
        <PlanCards onPick={setPlan} />
        <p className="form-help">Payment does not unlock content automatically. Access appears only after admin verification and role activation.</p>
      </div>
      {plan && <PayQrModal plan={plan} onClose={() => setPlan(null)} />}
    </section>
  )
}
