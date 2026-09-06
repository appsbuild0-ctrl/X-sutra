import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MediaGrid } from '../components/MediaGrid'
import { PremiumImageTile } from '../components/PremiumImageTile'
import { ScreenHeader } from '../components/ScreenHeader'
import { XIcon } from '../components/icons'
import { fetchPremiumCatalog, premiumMediaToItem, type PremiumCatalog } from '../lib/premium'
import { naturalFrameStyle } from '../lib/imageFit'
import type { MediaItem } from '../types'

/**
 * Premium library — everything the admin added to the premium catalog:
 * one grid for videos, one for images, newest first.
 */
export function PremiumLibraryScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState<number | null>(null)

  useEffect(() => {
    void fetchPremiumCatalog()
      .then(setCatalog)
      .catch(() => setCatalog(null))
      .finally(() => setLoading(false))
  }, [])

  const media = useMemo<MediaItem[]>(
    () => (catalog?.media ?? []).map(premiumMediaToItem),
    [catalog]
  )
  const videos = useMemo(() => media.filter((item) => Boolean(item.videoUrl)), [media])
  const images = useMemo(
    () => (catalog?.media ?? []).filter((item) => item.type === 'image'),
    [catalog]
  )
  const allImages = useMemo(
    () => images.map((item) => ({ id: item.id, url: item.thumbnail || item.url, title: item.title, width: item.width, height: item.height })),
    [images]
  )

  const open = (index: number): void => setLightbox(index)

  return (
    <section className="screen screen--ott">
      <ScreenHeader
        title="Library"
        eyebrow="Premium catalog"
        actions={<button className="round-button" type="button" onClick={() => navigate('/premium')} aria-label="Back">‹</button>}
      />

      {!loading && media.length === 0 && (
        <div className="empty-state">
          <strong>Abhi media nahi aaya</strong>
          <p className="form-help">Admin premium catalog me jo images/videos add karega wo yahan dikhenge.</p>
        </div>
      )}

      {loading && <div className="media-grid">{Array.from({ length: 6 }, (_, index) => <div className="media-skeleton" key={index} />)}</div>}

      {!loading && videos.length > 0 && (
        <>
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Videos</p><h3>Latest</h3></div></div>
          <MediaGrid items={videos} />
        </>
      )}

      {!loading && images.length > 0 && (
        <>
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Images</p><h3>Stored</h3></div></div>
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

      {lightbox !== null && allImages[lightbox] && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <div className="lightbox__inner" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="lightbox__close" onClick={() => setLightbox(null)} aria-label="Close"><XIcon size={24} /></button>
            <button type="button" className="lightbox__prev" disabled={lightbox === 0} onClick={() => setLightbox(lightbox - 1)} aria-label="Previous">‹</button>
            <img
              src={allImages[lightbox].url}
              alt={allImages[lightbox].title}
              className="lightbox__img"
              style={naturalFrameStyle(allImages[lightbox].width, allImages[lightbox].height)}
            />
            <button type="button" className="lightbox__next" disabled={lightbox >= allImages.length - 1} onClick={() => setLightbox(lightbox + 1)} aria-label="Next">›</button>
            <div className="lightbox__counter">{lightbox + 1} / {allImages.length}</div>
          </div>
        </div>
      )}
    </section>
  )
}
