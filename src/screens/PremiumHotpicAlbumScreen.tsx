import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { useApp } from '../context/AppContext'
import { hotpicApi, type HotpicAlbum } from '../lib/hotpic'

export function PremiumHotpicAlbumScreen(): React.JSX.Element {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { openPlayer } = useApp()
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
      {videos.length > 0 && <MediaGrid items={videos} empty={null} />}
      {images.length > 0 && (
        <div className="premium-image-grid">
          {images.map((item) => (
            <button
              key={item.id}
              className="premium-image"
              type="button"
              style={{ backgroundImage: `url(${item.thumbnail || item.previewUrl})` }}
              onClick={() => openPlayer({ ...item, videoUrl: item.previewUrl || item.sourceUrl, previewUrl: item.previewUrl || item.sourceUrl }, images)}
              aria-label={item.title}
            />
          ))}
        </div>
      )}
    </section>
  )
}
