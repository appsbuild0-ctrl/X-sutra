import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { fetchPremiumCatalog, premiumMediaToItem, type PremiumCatalog } from '../lib/premium'

export function PremiumChannelScreen(): React.JSX.Element {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)

  useEffect(() => { void fetchPremiumCatalog().then(setCatalog) }, [])

  const channel = catalog?.channels.find((entry) => entry.id === id)
  const albums = useMemo(() => (catalog?.albums ?? []).filter((album) => album.channelId === id), [catalog, id])
  const media = useMemo(() => (catalog?.media ?? []).filter((item) => item.channelId === id), [catalog, id])
  const videos = media.filter((item) => item.type === 'video')
  const images = media.filter((item) => item.type === 'image')
  const showImages = channel?.type !== 'videos'
  const showVideos = channel?.type !== 'images'

  return (
    <section className="screen">
      <ScreenHeader title={channel?.name ?? 'Channel'} eyebrow="Premium channel" actions={<button className="round-button" type="button" onClick={() => navigate('/premium?tab=categories')} aria-label="Back">‹</button>} />
      {!catalog && <div className="media-grid">{Array.from({ length: 4 }, (_, index) => <div className="media-skeleton" key={index} />)}</div>}
      {catalog && !channel && <div className="empty-state"><strong>Channel not found.</strong></div>}
      {channel && (
        <>
          <div className="premium-hero">
            <span className="premium-hero__badge">{channel.cover ? <img src={channel.cover} alt="" /> : '✦'}</span>
            <div>
              <p className="eyebrow">{channel.type}</p>
              <h2>{channel.name}</h2>
              <p>{channel.description || 'Premium channel'}</p>
            </div>
          </div>
          {albums.length > 0 && (
            <>
              <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Albums</p><h3>In this channel</h3></div></div>
              <div className="premium-album-grid">
                {albums.map((album) => (
                  <button key={album.id} className="premium-album" type="button" onClick={() => navigate(`/premium/album/${album.id}`)}>
                    <span className="premium-album__cover" style={album.cover ? { backgroundImage: `url(${album.cover})` } : undefined} />
                    <strong>{album.name}</strong>
                    <small>{album.description}</small>
                  </button>
                ))}
              </div>
            </>
          )}
          {showVideos && (
            <>
              <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Videos</p><h3>Channel reels</h3></div></div>
              <MediaGrid items={videos.map(premiumMediaToItem)} empty={<p className="form-help">No videos in this channel.</p>} />
            </>
          )}
          {showImages && images.length > 0 && (
            <>
              <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Images</p><h3>Channel photos</h3></div></div>
              <div className="premium-image-grid">
                {images.map((item) => <a key={item.id} className="premium-image" href={item.url} target="_blank" rel="noreferrer" style={{ backgroundImage: `url(${item.thumbnail || item.url})` }} />)}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
