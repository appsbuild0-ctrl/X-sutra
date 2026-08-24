import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LiveError } from '../components/LiveState'
import { PlayIcon, SearchIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { fetchPremiumCatalog, premiumMediaToItem, type PremiumCatalog } from '../lib/premium'

export function PremiumScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { openPlayer } = useApp()
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [heroIndex, setHeroIndex] = useState(0)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let live = true
    void fetchPremiumCatalog().then((next) => { if (live) setCatalog(next) }).catch((reason) => {
      if (live) setError(reason instanceof Error ? reason.message : 'Premium could not load.')
    })
    return () => { live = false }
  }, [])

  const heroes = catalog?.heroes ?? []
  const videos = useMemo(() => (catalog?.media ?? []).filter((item) => item.type === 'video'), [catalog])
  const albums = catalog?.albums ?? []
  const channels = catalog?.channels ?? []
  const hero = heroes[heroIndex] ?? heroes[0]
  const videoItems = videos.map(premiumMediaToItem)

  useEffect(() => {
    if (heroes.length < 2) return
    const timer = window.setInterval(() => setHeroIndex((current) => (current + 1) % heroes.length), 5000)
    return () => window.clearInterval(timer)
  }, [heroes.length])

  const playHero = () => {
    if (hero && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(hero.url)) {
      openPlayer(premiumMediaToItem({ id: hero.id, type: 'video', url: hero.url, thumbnail: hero.thumbnail, title: hero.title, tags: [], channelId: '', albumId: '', sourcePage: '', createdAt: hero.createdAt }))
      return
    }
    if (videoItems[0]) openPlayer(videoItems[0], videoItems)
  }

  return (
    <section className="screen screen--premium screen--ott">
      <form className="ott-search" onSubmit={(event) => { event.preventDefault(); navigate(`/premium/search${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`) }}>
        <SearchIcon size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Premium" aria-label="Search Premium" />
        <button className="ott-exit" type="button" onClick={() => navigate('/')}>Exit</button>
      </form>

      {error && <LiveError message={error} onRetry={() => { setError(null); void fetchPremiumCatalog().then(setCatalog) }} />}

      <div className="ott-hero" style={hero ? { backgroundImage: `url(${hero.thumbnail || hero.url})` } : undefined}>
        <div className="ott-hero__copy">
          <p className="eyebrow">Premium</p>
          <h2>{hero?.title || 'X-sutra Premium'}</h2>
          <button className="ott-play" type="button" onClick={playHero} disabled={!hero && !videoItems[0]}>
            <PlayIcon size={18} /> Play
          </button>
        </div>
        {heroes.length > 1 && <small className="ott-hero__count">{heroIndex + 1}/{heroes.length}</small>}
      </div>

      <div className="ott-row-head"><h3>Categories</h3></div>
      {channels.length ? (
        <div className="ott-rail" aria-label="Categories">
          {channels.map((channel, index) => (
            <button key={channel.id} className={`ott-cat ott-cat--${index % 4}`} type="button" onClick={() => navigate(`/premium/channel/${channel.id}`)}>
              {channel.cover && <img src={channel.cover} alt="" />}
              <strong>{channel.name}</strong>
            </button>
          ))}
        </div>
      ) : <p className="form-help">No categories yet.</p>}

      <div className="ott-row-head">
        <h3>Videos</h3>
        <button type="button" onClick={() => navigate('/premium/videos')} aria-label="All premium videos">›</button>
      </div>
      {videos.length ? (
        <div className="ott-rail">
          {videos.slice(0, 12).map((item) => (
            <button key={item.id} className="ott-card" type="button" onClick={() => openPlayer(premiumMediaToItem(item), videoItems)}>
              <span style={{ backgroundImage: `url(${item.thumbnail || item.url})` }} />
              <strong>{item.title}</strong>
            </button>
          ))}
        </div>
      ) : <p className="form-help">No premium videos yet.</p>}

      <div className="ott-row-head"><h3>Latest Premium albums</h3></div>
      {albums.length ? (
        <div className="ott-rail">
          {albums.map((album) => (
            <button key={album.id} className="ott-card" type="button" onClick={() => navigate(`/premium/album/${album.id}`)}>
              <span style={album.cover ? { backgroundImage: `url(${album.cover})` } : undefined} />
              <strong>{album.name}</strong>
            </button>
          ))}
        </div>
      ) : <p className="form-help">No premium albums yet.</p>}
    </section>
  )
}
