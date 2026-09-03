import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { hotpicApi, type HotpicAlbum } from '../lib/hotpic'
import { UNCROPPED_IMAGE_STYLE } from '../lib/imageFit'

export function PremiumHotpicAlbumScreen(): React.JSX.Element {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [album, setAlbum] = useState<HotpicAlbum | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void hotpicApi.album(id).then((next) => { if (live) setAlbum(next) }).catch((reason) => {
      if (live) setError(reason instanceof Error ? reason.message : 'Album unavailable')
    })
    return () => { live = false }
  }, [id])

  const videos = album?.items.filter((item) => item.videoUrl) ?? []
  const images = album?.items.filter((item) => !item.videoUrl) ?? []

  return (
    <section className="screen screen--ott">
      <ScreenHeader title={album?.title ?? 'Album'} eyebrow={`Hotpic · @${album?.owner || 'account'}`} actions={<button className="round-button" type="button" onClick={() => navigate(-1)} aria-label="Back">‹</button>} />
      {error && <p className="form-help">{error}</p>}
      <div className="ott-row-head"><h3>Videos</h3></div>
      {videos.length ? <MediaGrid items={videos} empty={null} /> : <p className="form-help">No videos in this album.</p>}
      <div className="ott-row-head"><h3>Pics</h3></div>
      {images.length ? (
        <div className="premium-image-grid">
          {images.map((item) => (
            <button
              key={item.id}
              className="premium-image"
              type="button"
              onClick={() => window.open(item.previewUrl || item.thumbnail || item.sourceUrl, '_blank', 'noopener,noreferrer')}
              aria-label={item.title}
            >
              <img src={item.thumbnail || item.previewUrl} alt={item.title} loading="lazy" style={UNCROPPED_IMAGE_STYLE} />
            </button>
          ))}
        </div>
      ) : <p className="form-help">No pics in this album.</p>}
    </section>
  )
}
