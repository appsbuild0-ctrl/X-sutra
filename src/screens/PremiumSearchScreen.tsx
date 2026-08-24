import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PlayIcon, SearchIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { hotpicApi, type HotpicAlbumCard, type HotpicFeed } from '../lib/hotpic'

export function PremiumSearchScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { openPlayer } = useApp()
  const [params] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [feed, setFeed] = useState<HotpicFeed | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const tag = query.trim().replace(/[^A-Za-z0-9-]/g, '') || 'Desi'
    setBusy(true)
    void hotpicApi.feed(tag, 1).then(setFeed).finally(() => setBusy(false))
  }, [query])

  const openCard = (card: HotpicAlbumCard) => {
    if ((card.kind || 'album') === 'album') {
      navigate(`/premium/hotpic/${card.id}`)
      return
    }
    openPlayer(hotpicApi.cardToMedia(card))
  }

  const Grid = ({ cards }: { cards: HotpicAlbumCard[] }) => cards.length ? (
    <div className="hp-grid">
      {cards.map((card) => (
        <button key={`${card.kind}-${card.id}`} className="hp-card" type="button" onClick={() => openCard(card)}>
          <span className="hp-card__media" style={card.cover ? { backgroundImage: `url(${card.cover})` } : undefined}>
            {(card.kind === 'video' || card.hasVideo) && <i className="hp-card__play"><PlayIcon size={18} /></i>}
          </span>
          <strong>{card.title}</strong>
        </button>
      ))}
    </div>
  ) : null

  return (
    <section className="screen screen--ott">
      <form className="ott-search" onSubmit={(event) => event.preventDefault()}>
        <SearchIcon size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search albums, pics, videos..." autoFocus />
      </form>
      {busy && <p className="form-help">Searching…</p>}
      <div className="ott-row-head"><h3>Albums</h3></div>
      <Grid cards={feed?.albums ?? []} />
      <div className="ott-row-head"><h3>Pics</h3></div>
      <Grid cards={feed?.pics ?? []} />
      <div className="ott-row-head"><h3>Videos</h3></div>
      <Grid cards={feed?.videos ?? []} />
    </section>
  )
}
