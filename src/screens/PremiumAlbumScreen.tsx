import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { fetchPremiumCatalog, premiumMediaToItem, type PremiumCatalog } from '../lib/premium'

export function PremiumAlbumScreen(): React.JSX.Element {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)

  useEffect(() => { void fetchPremiumCatalog().then(setCatalog) }, [])
  const album = catalog?.albums.find((entry) => entry.id === id)
  const media = useMemo(() => (catalog?.media ?? []).filter((item) => item.albumId === id), [catalog, id])

  return (
    <section className="screen">
      <ScreenHeader title={album?.name ?? 'Album'} eyebrow="Premium album" actions={<button className="round-button" type="button" onClick={() => navigate(-1)} aria-label="Back">‹</button>} />
      {album && (
        <>
          <div className="premium-hero">
            <span className="premium-hero__badge">✦</span>
            <div>
              <p className="eyebrow">{new Date(album.updatedAt || album.createdAt).toLocaleDateString('en-IN')}</p>
              <h2>{album.name}</h2>
              <p>{album.description || 'Premium album'}</p>
              {album.tags?.length > 0 && <small>{album.tags.join(', ')}</small>}
            </div>
          </div>
          <MediaGrid items={media.filter((item) => item.type === 'video').map(premiumMediaToItem)} empty={media.some((item) => item.type === 'video') ? undefined : <p className="form-help">No videos in this album.</p>} />
          <div className="premium-image-grid">
            {media.filter((item) => item.type === 'image').map((item) => (
              <a key={item.id} className="premium-image" href={item.url} target="_blank" rel="noreferrer" style={{ backgroundImage: `url(${item.thumbnail || item.url})` }} />
            ))}
          </div>
        </>
      )}
      {catalog && !album && <div className="empty-state"><strong>Album not found.</strong></div>}
    </section>
  )
}
