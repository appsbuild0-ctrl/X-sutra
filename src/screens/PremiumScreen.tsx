import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CreatorAvatar } from '../components/CreatorAvatar'
import { LiveError } from '../components/LiveState'
import { SearchIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { compactNumber } from '../lib/format'
import { hotpicApi } from '../lib/hotpic'
import { fetchPremiumCatalog, premiumMediaToItem, type PremiumCatalog } from '../lib/premium'
import type { Creator } from '../types'

export function PremiumScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { openPlayer } = useApp()
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)
  const [models, setModels] = useState<Creator[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let live = true
    void Promise.allSettled([fetchPremiumCatalog(), hotpicApi.topModels()]).then(([catalogResult, modelsResult]) => {
      if (!live) return
      if (catalogResult.status === 'fulfilled') setCatalog(catalogResult.value)
      if (modelsResult.status === 'fulfilled') setModels(modelsResult.value)
      setModelsLoading(false)
      if (catalogResult.status === 'rejected' && modelsResult.status === 'rejected') {
        setError('Premium could not load.')
      }
    })
    return () => { live = false }
  }, [])

  const videos = useMemo(() => (catalog?.media ?? []).filter((item) => item.type === 'video'), [catalog])
  const albums = catalog?.albums ?? []
  const videoItems = videos.map(premiumMediaToItem)

  return (
    <section className="screen screen--premium screen--ott">
      <form className="ott-search" onSubmit={(event) => { event.preventDefault(); navigate(`/premium/search${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`) }}>
        <SearchIcon size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Premium" aria-label="Search Premium" />
        <button className="ott-exit" type="button" onClick={() => navigate('/')}>Exit</button>
      </form>

      {error && <LiveError message={error} onRetry={() => window.location.reload()} />}

      <div className="ott-row-head"><h3>Top models</h3></div>
      {models.length ? (
        <div className="ott-rail ott-models" aria-label="Hotpic Desi accounts">
          {models.map((model, index) => (
            <button key={model.username} className="ott-model" type="button" onClick={() => navigate(`/premium/model/${encodeURIComponent(model.username)}`)}>
              <CreatorAvatar src={model.avatar} label={model.displayName || model.username} index={index} className="ott-model__avatar" />
              <strong>{model.displayName || model.username}</strong>
              <small>@{model.username}</small>
              {model.gifs > 0 && <small>{compactNumber(model.gifs)} albums</small>}
            </button>
          ))}
        </div>
      ) : <p className="form-help">{modelsLoading ? 'Loading Hotpic Desi accounts…' : 'No Hotpic accounts loaded.'}</p>}

      {videos.length > 0 && (
        <>
          <div className="ott-row-head">
            <h3>Videos</h3>
            <button type="button" onClick={() => navigate('/premium/videos')} aria-label="All premium videos">›</button>
          </div>
          <div className="ott-rail">
            {videos.slice(0, 12).map((item) => (
              <button key={item.id} className="ott-card" type="button" onClick={() => openPlayer(premiumMediaToItem(item), videoItems)}>
                <span style={{ backgroundImage: `url(${item.thumbnail || item.url})` }} />
                <strong>{item.title}</strong>
              </button>
            ))}
          </div>
        </>
      )}

      {albums.length > 0 && (
        <>
          <div className="ott-row-head"><h3>Latest Premium albums</h3></div>
          <div className="ott-rail">
            {albums.map((album) => (
              <button key={album.id} className="ott-card" type="button" onClick={() => navigate(`/premium/album/${album.id}`)}>
                <span style={album.cover ? { backgroundImage: `url(${album.cover})` } : undefined} />
                <strong>{album.name}</strong>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
