import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MediaGrid } from '../components/MediaGrid'
import { SearchIcon } from '../components/icons'
import { emptyCatalog, fetchPremiumCatalog, premiumMediaToItem, searchPremium, type PremiumCatalog } from '../lib/premium'

export function PremiumSearchScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)
  const [query, setQuery] = useState(params.get('q') ?? '')

  useEffect(() => { void fetchPremiumCatalog().then(setCatalog) }, [])
  const results = useMemo(() => searchPremium(catalog ?? emptyCatalog(), query), [catalog, query])

  return (
    <section className="screen screen--ott">
      <form className="ott-search" onSubmit={(event) => event.preventDefault()}>
        <SearchIcon size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search albums, videos, categories..." autoFocus />
      </form>
      {query.trim() && !results.albums.length && !results.media.length && !results.channels.length && <div className="empty-state"><strong>No results found</strong></div>}
      {results.channels.length > 0 && (
        <div className="ott-rail">{results.channels.map((channel) => <button key={channel.id} className="ott-cat" type="button" onClick={() => navigate(`/premium/channel/${channel.id}`)}><strong>{channel.name}</strong></button>)}</div>
      )}
      {results.albums.length > 0 && (
        <div className="ott-rail">
          {results.albums.map((album) => (
            <button key={album.id} className="ott-card" type="button" onClick={() => navigate(`/premium/album/${album.id}`)}>
              <span style={album.cover ? { backgroundImage: `url(${album.cover})` } : undefined} />
              <strong>{album.name}</strong>
            </button>
          ))}
        </div>
      )}
      <MediaGrid items={results.media.filter((item) => item.type === 'video').map(premiumMediaToItem)} empty={null} />
      <div className="premium-image-grid">
        {results.media.filter((item) => item.type === 'image').map((item) => (
          <a key={item.id} className="premium-image" href={item.url} target="_blank" rel="noreferrer" style={{ backgroundImage: `url(${item.thumbnail || item.url})` }} />
        ))}
      </div>
    </section>
  )
}
