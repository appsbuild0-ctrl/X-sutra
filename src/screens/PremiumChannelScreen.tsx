import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MediaGrid } from '../components/MediaGrid'
import { PremiumImageTile } from '../components/PremiumImageTile'
import { ScreenHeader } from '../components/ScreenHeader'
import { XIcon } from '../components/icons'
import { fetchPremiumCatalog, premiumMediaToItem, type PremiumCatalog, type PremiumMedia } from '../lib/premium'
import { naturalFrameStyle } from '../lib/imageFit'

/**
 * One Premium section: the media the admin stored in the premium catalog for
 * this channel, newest first, plus any albums that live inside it.
 */
export function PremiumChannelScreen(): React.JSX.Element {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)
  const [lightbox, setLightbox] = useState<number | null>(null)

  useEffect(() => { void fetchPremiumCatalog().then(setCatalog) }, [])

  const channel = catalog?.channels.find((entry) => entry.id === id)
  const albums = useMemo(() => (catalog?.albums ?? []).filter((album) => album.channelId === id), [catalog, id])

  const media: PremiumMedia[] = useMemo(() => {
    return (catalog?.media ?? [])
      .filter((entry) => entry.channelId === id)
      .sort((a, b) => Date.parse(b.createdAt || '0') - Date.parse(a.createdAt || '0'))
  }, [catalog, id])

  const videos = media.filter((item) => item.type === 'video')
  const images = media.filter((item) => item.type === 'image')
  const showImages = channel?.type !== 'videos'
  const showVideos = channel?.type !== 'images'

  return (
    <section className="screen">
      <ScreenHeader
        title={channel?.name ?? 'Channel'}
        eyebrow={channel?.type || 'Premium channel'}
        actions={<button className="round-button" type="button" onClick={() => navigate('/premium/library')} aria-label="Back">‹</button>}
      />
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
                {images.map((item, index) => (
                  <PremiumImageTile
                    key={item.id}
                    url={item.thumbnail || item.url}
                    title={item.title}
                    width={item.width}
                    height={item.height}
                    onOpen={() => setLightbox(index)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {lightbox !== null && images[lightbox] && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <div className="lightbox__inner" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="lightbox__close" onClick={() => setLightbox(null)} aria-label="Close"><XIcon size={24} /></button>
            <button type="button" className="lightbox__prev" disabled={lightbox === 0} onClick={() => setLightbox(lightbox - 1)} aria-label="Previous">‹</button>
            <img
              src={images[lightbox].thumbnail || images[lightbox].url}
              alt={images[lightbox].title}
              className="lightbox__img"
              style={naturalFrameStyle(images[lightbox].width, images[lightbox].height)}
            />
            <button type="button" className="lightbox__next" disabled={lightbox >= images.length - 1} onClick={() => setLightbox(lightbox + 1)} aria-label="Next">›</button>
            <div className="lightbox__counter">{lightbox + 1} / {images.length}</div>
          </div>
        </div>
      )}
    </section>
  )
}
