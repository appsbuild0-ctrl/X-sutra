import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MediaGrid } from '../components/MediaGrid'
import { PremiumImageTile } from '../components/PremiumImageTile'
import { ScreenHeader } from '../components/ScreenHeader'
import { XIcon } from '../components/icons'
import { fetchPremiumCatalog, premiumMediaToItem, type PremiumCatalog } from '../lib/premium'
import { naturalFrameStyle } from '../lib/imageFit'

/**
 * Premium library — everything in the stored premium catalog, grouped by
 * section. Admins add content from the Premium admin console; this screen
 * just shows it, newest sections first.
 */
export function PremiumLibraryScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)
  const [lightbox, setLightbox] = useState<number | null>(null)

  useEffect(() => {
    void fetchPremiumCatalog().then(setCatalog)
  }, [])

  const media = catalog?.media ?? []
  const images = useMemo(() => media.filter((item) => item.type === 'image'), [media])
  const videos = useMemo(() => media.filter((item) => item.type === 'video').map(premiumMediaToItem), [media])
  const channels = useMemo(() => {
    const list = catalog?.channels ?? []
    return list
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        count: media.filter((item) => item.channelId === channel.id).length
      }))
      .filter((channel) => channel.count > 0)
      .slice(0, 12)
  }, [catalog, media])

  const open = (index: number) => setLightbox(index)

  return (
    <section className="screen screen--ott">
      <ScreenHeader
        title="Library"
        eyebrow="Premium catalog"
        actions={<button className="round-button" type="button" onClick={() => navigate('/premium')} aria-label="Back">‹</button>}
      />

      {!catalog && <div className="media-grid">{Array.from({ length: 6 }, (_, index) => <div className="media-skeleton" key={index} />)}</div>}

      {catalog && !media.length && (
        <div className="empty-state">
          <strong>Library is empty</strong>
          <p className="form-help">Admin abhi koi media upload nahi kiya. Upload hote hi yahan dikhega.</p>
        </div>
      )}

      {channels.length > 0 && (
        <div className="library-sections">
          {channels.map((channel) => (
            <button key={channel.id} type="button" className="library-section" onClick={() => navigate(`/premium/channel/${channel.id}`)}>
              <strong>{channel.name}</strong>
              <small>{channel.count} media</small>
            </button>
          ))}
        </div>
      )}

      {catalog && videos.length > 0 && (
        <>
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Videos</p><h3>Premium reels</h3></div></div>
          <MediaGrid items={videos} />
        </>
      )}

      {catalog && images.length > 0 && (
        <>
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Images</p><h3>Premium photos</h3></div></div>
          <div className="premium-image-grid">
            {images.map((item, index) => (
              <PremiumImageTile
                key={item.id}
                url={item.thumbnail || item.url}
                title={item.title}
                width={item.width}
                height={item.height}
                onOpen={() => open(index)}
              />
            ))}
          </div>
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
