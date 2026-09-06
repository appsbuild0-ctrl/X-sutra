import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
const detailInFlight = new Map<string, Promise<MediaItem | null>>()

/** Ids whose detail request already failed this session — failed cards must
 *  keep their feed-supplied media instead of retry-storming the API. */
const detailFailed = new Set<string>()

/** True when the URL can be used as a <video> preview source. The premium
 *  IndexedDB resolver can hand back `blob:` URLs and same-origin `/api/...`
 *  file URLs, neither of which contains a video extension. */
function isPreviewableVideoSource(url: string): boolean {
  if (!url) return false
  if (/^(?:blob:)/i.test(url)) return true
  if (url.startsWith('/')) return url.startsWith('/api/media') || url.startsWith('/api/premium-file') || /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url)
  return /^https?:\/\//i.test(url) && /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url)
}

/** Fold a hydrated detail record into what the card is ALREADY showing.
 *  Stats/title always refresh, but the visible media (thumbnail chain,
 *  preview, video URLs) is kept whenever the card already has one. Replacing
 *  the whole item on hydration remounted the <img>/<video> with a different
 *  source — every card visibly blinked the moment its detail landed. */
function mergeHydrated(current: MediaItem, detail: MediaItem): MediaItem {
  return {
    ...detail,
    thumbnail: current.thumbnail || detail.thumbnail,
    thumbnailUrls: current.thumbnailUrls?.length ? current.thumbnailUrls : detail.thumbnailUrls,
    previewUrl: current.previewUrl || detail.previewUrl,
    videoUrl: current.videoUrl || detail.videoUrl,
    videoUrlSd: current.videoUrlSd || detail.videoUrlSd,
    watermarkedUrls: current.watermarkedUrls?.length ? current.watermarkedUrls : detail.watermarkedUrls
  }
}

/** True when the item already carries something the card can display — a
 *  thumbnail or a playable preview/video. Such cards never need a detail
 *  fetch, so scrolling a feed no longer fires one API call per card (the
 *  resulting rate-limit failures were what emptied cards out). */
function hasUsableMedia(item: MediaItem): boolean {
  if (item.thumbnailUrls?.length || item.thumbnail) return true
  return isPreviewableVideoSource(item.previewUrl ?? item.videoUrlSd ?? item.videoUrl ?? '')
}

/** Throttle detail API calls - one shared request per item id, cached for the
 *  session. Resolves to null on failure (recorded in detailFailed) so callers
 *  simply keep showing the feed item instead of an empty placeholder. */
function throttleDetailRequest(itemId: string, task: () => Promise<MediaItem>): Promise<MediaItem | null> {
  const cached = detailCache.get(itemId)
  if (cached) return Promise.resolve(cached)

  // Premium catalog items are complete already - never hit the public API for them
  if (itemId.startsWith('pm-') || itemId.startsWith('premium-') || itemId.startsWith('hp-')) {
    return Promise.resolve(null)
  }

  const inFlight = detailInFlight.get(itemId)
  if (inFlight) return inFlight

  const request = task()
    .then((full): MediaItem | null => {
      detailCache.set(itemId, full)
      return full
    })
    .catch((): MediaItem | null => {
      detailInFlight.delete(itemId)
      detailFailed.add(itemId)
      return null
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
  const isPremium = item.id.startsWith('pm-') || item.id.startsWith('premium-') || item.id.startsWith('hp-') || item.creator === 'premium'
  const [resolved, setResolved] = useState<MediaItem | null>(() => detailCache.get(item.id) ?? null)
  const [thumbnailIndex, setThumbnailIndex] = useState(0)
  const [imageExhausted, setImageExhausted] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [opening, setOpening] = useState(false)
  const [videoPausedByUser, setVideoPausedByUser] = useState(false)

  // Apply a hydrated detail record without disturbing the media the card is
  // already showing (keeping the thumbnail/preview identity is what stops the
  // cards from blinking when hydration lands).
  const applyHydrated = useCallback((detail: MediaItem | null) => {
    if (!detail?.id) return
    setResolved((current) => {
      if (current) return current
      return mergeHydrated(item, detail)
    })
  }, [item])

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

  // Hydrate detail URLs lazily once the card is in view — but only when the
  // feed gave this card nothing to show. Cards that already have thumbnails /
  // a preview are left alone: the fetch adds nothing, and its failure used to
  // swap in a bogus "Loading…" shell that emptied the whole card (premium
  // cards always took that path, which is why their grids rendered empty).
  useEffect(() => {
    if (!inView || resolved || isPremium || !item.id) return
    if (hasUsableMedia(item) || detailFailed.has(item.id)) return
    void throttleDetailRequest(item.id, () => publicMediaApi.getById(item.id)).then(applyHydrated)
  }, [inView, item, resolved, isPremium, applyHydrated])

  // Reset per-item state when a different item lands in this card
  useEffect(() => {
    setResolved(isPremium ? null : (detailCache.get(item.id) ?? null))
    setThumbnailIndex(0)
    setImageExhausted(false)
    setPreviewFailed(false)
  }, [item.id, isPremium])

  // Once every thumbnail failed, hydrate in the background to find fresh
  // media (and stats). mergeHydrated keeps the current preview/video URLs, so
  // a playing <video> preview is never swapped or wiped when this lands.
  useEffect(() => {
    if (!imageExhausted || resolved || !inView || isPremium || !item.id) return
    if (detailFailed.has(item.id)) return
    void throttleDetailRequest(item.id, () => publicMediaApi.getById(item.id)).then(applyHydrated)
  }, [imageExhausted, inView, item, resolved, isPremium, applyHydrated])
  const display = resolved ?? item
  const saved = isSaved(display.id)
  const thumbnails = useMemo(() => [...new Set((display.thumbnailUrls?.length ? display.thumbnailUrls : (display.thumbnail ? [display.thumbnail] : [])).filter(Boolean))], [display.thumbnail, display.thumbnailUrls])
  const activeThumbnail = !imageExhausted ? thumbnails[thumbnailIndex] : undefined
  const previewCandidate = display.previewUrl ?? display.videoUrlSd ?? display.videoUrl ?? ''
  const previewSource = isPreviewableVideoSource(previewCandidate) ? previewCandidate : undefined
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
    if (!resolved && !isPremium && !detailFailed.has(item.id)) {
      void throttleDetailRequest(item.id, () => publicMediaApi.getById(item.id)).then(applyHydrated)
    }
    setTimeout(() => setOpening(false), 300)
  }

  // Handle video ref for autoplay control.
  //
  // Stability contract (the feed "blink" fix): this effect must ONLY re-run when
  // the <video> element itself is replaced (previewSource is also its React
  // key). Late detail hydration changes `resolved` — an unrelated value — and
  // previously sat in the dependency list, so the effect re-ran, its cleanup
  // wiped video.src, and because the key was unchanged React never restored
  // the source: every feed card blinked black the moment its detail loaded.
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Mobile browsers only autoplay muted, inline video.
    video.muted = true
    video.playsInline = true
    video.preload = 'auto' // Load metadata immediately for zero lag
    video.playbackRate = Math.max(0.5, Math.min(2, video.playbackRate || 1))
    // Old Android WebViews return undefined from play(); normalise before any
    // .then/.catch so a click / preview autoplay never crashes the feed.
    try {
      const p = video.play() as unknown
      if (p && typeof (p as Promise<void>).then === 'function') {
        void (p as Promise<void>).catch(() => undefined)
      }
    } catch { /* desktop/jsdom preview is optional */ }

    const onPlaying = () => setVideoPausedByUser(false)
    const onPause = () => setVideoPausedByUser(true)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('pause', onPause)

    return () => {
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('pause', onPause)
      // NEVER clear video.src in this cleanup: the element is either discarded
      // by React (nothing to preserve) or kept with its source. Wiping it on a
      // kept element leaves a permanently black, unresponsive preview.
      try { video.pause() } catch { /* jsdom/autplay edge cases */ }
    }
  }, [previewSource])

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
            autoPlay
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
