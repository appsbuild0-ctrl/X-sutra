import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CreatorAvatar } from '../components/CreatorAvatar'
import { LiveError } from '../components/LiveState'
import { PlayIcon, SearchIcon } from '../components/icons'
import { hotpicApi, type HotpicAlbumCard } from '../lib/hotpic'
import type { Creator } from '../types'

export function PremiumScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const [models, setModels] = useState<Creator[]>([])
  const [albums, setAlbums] = useState<HotpicAlbumCard[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = async (nextPage: number, append: boolean) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const feed = await hotpicApi.feed('Desi', nextPage)
      if (!append) setModels(feed.users)
      setAlbums((current) => append ? [...current, ...feed.albums.filter((album) => !current.some((entry) => entry.id === album.id))] : feed.albums)
      setPage(nextPage)
    } catch (reason) {
      if (!append) {
        const fallback = await hotpicApi.topModels()
        setModels(fallback)
        setError(reason instanceof Error ? reason.message : 'Hotpic feed could not load.')
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => { void load(1, false) }, [])

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

      <div className="ott-row-head"><h3>Pics & videos</h3></div>
      {loading && <div className="media-grid">{Array.from({ length: 6 }, (_, index) => <div className="media-skeleton" key={index} />)}</div>}
      {!loading && albums.length === 0 && <p className="form-help">No Hotpic albums loaded. Open Premium on a Netlify deploy so /api/hotpic can fetch the public Desi page.</p>}
      <div className="hp-grid">
        {albums.map((album) => (
          <button key={album.id} className="hp-card" type="button" onClick={() => navigate(`/premium/hotpic/${album.id}`)}>
            <span className="hp-card__media" style={{ backgroundImage: `url(${album.cover})` }}>
              {album.hasVideo && <i className="hp-card__play"><PlayIcon size={18} /></i>}
            </span>
            <strong>{album.title}</strong>
            {album.owner && <small>@{album.owner}</small>}
          </button>
        ))}
      </div>
      {albums.length > 0 && (
        <div className="load-more-wrap">
          <button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void load(page + 1, true)}>
            {loadingMore ? 'Loading…' : 'Load more below'}
          </button>
        </div>
      )}
    </section>
  )
}
