import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { compactNumber, durationLabel } from '../lib/format'
import { isUncroppedImage, naturalFrameStyle } from '../lib/imageFit'
import { publicMediaApi } from '../lib/redgifs'
import type { MediaItem } from '../types'
import { useApp } from '../context/AppContext'
import { BookmarkIcon, PlayIcon } from './icons'

interface MediaCardProps {
  item: MediaItem
  queue?: MediaItem[]
  priority?: boolean
}

/** Module-level detail cache so every card reuses hydrated media details */
const detailCache = new Map<string, MediaItem>()

/** In-flight detail requests keyed by item id - guarantees max one API call per id */
const detailInFlight = new Map<string, Promise<MediaItem>>()

function premiumPlaceholder(itemId: string): MediaItem {
  return { id: itemId, title: 'Premium', duration: 0 } as MediaItem
}

/** Throttle detail API calls - one shared request per item id, cached for the session */
function throttleDetailRequest(itemId: string, task: () => Promise<MediaItem>): Promise<MediaItem> {
  const cached = detailCache.get(itemId)
  if (cached) return Promise.resolve(cached)

  // Premium catalog items are complete already - never hit the public API for them
  if (itemId.startsWith('pm-') || itemId.startsWith('premium-') || itemId.startsWith('hp-')) {
    return Promise.resolve(premiumPlaceholder(itemId))
  }

  const inFlight = detailInFlight.get(itemId)
  if (inFlight) return inFlight

  const request = task()
    .then((full) => {
      detailCache.set(itemId, full)
      return full
    })
    .catch(() => {
      detailInFlight.delete(itemId)
      return { id: itemId, title: 'Loading…', duration: 0 } as MediaItem
    })
  detailInFlight.set(itemId, request)
  return request
}

/** Real media card: hydrate detail URLs lazily from /v2/gifs/:id when a feed omits them. */
export function MediaCard({ item, queue, priority = false }: MediaCardProps): React.JSX.Element {
  const { isSaved, openPlayer, toggleSaved } = useApp()
  const navigate = useNavigate()
  const cardRef = useRef<HTMLElement | null>(null)
  const [inView, setInView] = useState(priority)
  const [resolved, setResolved] = useState<MediaItem | null>(() => detailCache.get(item.id) ?? null)
  const [thumbnailIndex, setThumbnailIndex] = useState(0)
  const [imageExhausted, setImageExhausted] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [opening, setOpening] = useState(false)
  const [videoPausedByUser, setVideoPausedByUser] = useState(false)

  // Watch the card and hydrate lazily once it scrolls into view
  useEffect(() => {
    const node = cardRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '400px 0px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // Hydrate detail URLs lazily once the card is in view
  useEffect(() => {
    if (!inView || resolved || !item.id) return
    void throttleDetailRequest(item.id, () => publicMediaApi.getById(item.id)).then((full) => {
      if (full.id) setResolved(full)
    }).catch(() => undefined)
  }, [inView, item, resolved])

  // Reset per-item state when a different item lands in this card
  useEffect(() => {
    setResolved(detailCache.get(item.id) ?? null)
    setThumbnailIndex(0)
    setImageExhausted(false)
    setPreviewFailed(false)
  }, [item.id])

  // Background hydration once thumbnail previews are exhausted
  useEffect(() => {
    if (!imageExhausted || resolved || !inView) return
    void throttleDetailRequest(item.id, () => publicMediaApi.getById(item.id)).then((full) => {
      if (full.id) setResolved(full)
    }).catch(() => undefined)
  }, [imageExhausted, inView, item, resolved])

  const isPremium = item.id.startsWith('pm-') || item.id.startsWith('premium-') || item.id.startsWith('hp-') || item.creator === 'premium'
  const display = resolved ?? item
  const saved = isSaved(display.id)
  const thumbnails = useMemo(() => [...new Set((display.thumbnailUrls?.length ? display.thumbnailUrls : (display.thumbnail ? [display.thumbnail] : [])).filter(Boolean))], [display.thumbnail, display.thumbnailUrls])
  const activeThumbnail = !imageExhausted ? thumbnails[thumbnailIndex] : undefined
  const previewSource = /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(display.previewUrl ?? display.videoUrlSd ?? display.videoUrl ?? '')
    ? (display.previewUrl ?? display.videoUrlSd ?? display.videoUrl)
    : undefined
  const embedUrl = isPremium ? '' : `https://www.redgifs.com/ifr/${encodeURIComponent(display.id)}?autoplay=1`
  const uncropped = isPremium && isUncroppedImage(display)
  const frameStyle = uncropped ? naturalFrameStyle(display.width, display.height) : {}

  const nextThumbnail = () => {
    if (thumbnailIndex + 1 < thumbnails.length) setThumbnailIndex((current) => current + 1)
    else setImageExhausted(true)
  }

  const open = () => {
    setOpening(true)
    const full = resolved ?? item
    const fullQueue = (queue?.length ? queue : [item]).map((entry) => entry.id === full.id ? full : (detailCache.get(entry.id) ?? entry))
    openPlayer(full, fullQueue)

    // Hydrate in background to get better URLs if not already loaded
    if (!resolved && !isPremium) {
      void throttleDetailRequest(item.id, () => publicMediaApi.getById(item.id)).then((hydrated) => {
        setResolved(hydrated)
      }).catch(() => undefined)
    }
    setTimeout(() => setOpening(false), 300)
  }

  // Handle video ref for autoplay control
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    // When video element is ready, setup autoplay with muted start
    // On user click, we'll unmute for playback
    if (!videoRef.current) return

    const video = videoRef.current
    video.muted = true // Required for autoplay on mobile browsers
    video.playsInline = true
    video.preload = 'auto' // Load metadata immediately for zero lag

    // Store original playback rate if needed
    const originalRate = video.playbackRate

    // Ensure consistent playback rate
    video.playbackRate = Math.max(0.5, Math.min(2, originalRate || 1))

    // Reset video state when source changes
    video.onplaying = () => {
      // Video started playing - can unmute if user interacted
      setVideoPausedByUser(false)
    }

    video.onpause = () => {
      setVideoPausedByUser(true)
    }

    // Cleanup
    return () => {
      video.src = ''
      video.load()
      video.pause()
      video.currentTime = 0
      video.removeAttribute('autoplay')
    }
  }, [display.previewUrl, display.videoUrlSd, display.videoUrl, resolved?.id, inView])

  const handlePlayClick = () => {
    // User clicked play - unpause/mute handling
    setVideoPausedByUser(false)
    // The video element will handle autoplay unmute on user interaction
  }

  return (
    <article className="media-card" ref={cardRef}>
      <button
        className={`media-card__visual${activeThumbnail || (previewSource && !previewFailed) ? '' : ' media-card__visual--empty'}${uncropped ? ' media-card__visual--natural' : ''}`}
        style={frameStyle}
        type="button"
        onClick={() => open()}
        aria-label={`Open ${display.title}`}
      >
        {activeThumbnail ? (
          <img key={activeThumbnail} src={activeThumbnail} alt="" loading={priority ? 'eager' : 'lazy'} decoding="async" onError={nextThumbnail} />
        ) : previewSource && inView && !previewFailed ? (
          <video
            ref={videoRef}
            key={previewSource}
            src={previewSource}
            muted
            playsInline
            preload="auto"
            poster={display.thumbnail}
            onError={() => setPreviewFailed(true)}
          />
        ) : previewFailed ? (
          <span className="media-card__missing">Video unavailable</span>
        ) : (
          <span className="media-card__missing">{opening ? 'Opening…' : 'Preview'}</span>
        )}
        <span className="media-card__shade" aria-hidden="true" />
        <span className="media-card__play" aria-hidden="true" onClick={handlePlayClick}><PlayIcon size={18} /></span>
        <span className="media-card__duration">{durationLabel(display.duration)}</span>
        {display.hasAudio && <span className="media-card__audio">Audio</span>}
      </button>

      <div className="media-card__info">
        <div className="media-card__copy">
          <button className="media-card__title" type="button" onClick={() => open()}>{display.title}</button>
          <button className="media-card__creator" type="button" onClick={() => navigate(`/creator/${encodeURIComponent(display.creator)}`)}>@{display.creator}</button>
        </div>
        <button className={`save-button${saved ? ' is-saved' : ''}`} type="button" aria-label={saved ? `Remove ${display.title} from library` : `Save ${display.title} to library`} onClick={() => toggleSaved(display)}><BookmarkIcon size={17} filled={saved} /></button>
      </div>
      <div className="media-card__meta"><span>{compactNumber(display.views)} views</span><span>{compactNumber(display.likes)} likes</span></div>
    </article>
  )
}
