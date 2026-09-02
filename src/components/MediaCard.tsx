import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { compactNumber, durationLabel } from '../lib/format'
import { isUncroppedImage, naturalFrameStyle } from '../lib/imageFit'
import { hotpicApi } from '../lib/hotpic'
import { publicMediaApi } from '../lib/redgifs'
import type { MediaItem } from '../types'
import { useApp } from '../context/AppContext'
import { BookmarkIcon, PlayIcon } from './icons'

interface MediaCardProps {
  item: MediaItem
  queue?: MediaItem[]
  priority?: boolean
}

/** Shared IntersectionObserver for the entire media grid - reduces observer overhead */
const gridObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && entry.target.dataset?.onLoad) {
        const task = entry.target.dataset.onLoad as () => void
        task()
      }
    })
  },
  { rootMargin: '400px 0px' }
)

/** Throttle detail API calls - max 2 per frame */
const detailRequestThrottle = new Set<string>()
const detailRequestQueue: Array<{ id: string; resolve: (item: MediaItem) => void }> = []
let isProcessing = false

function throttleDetailRequest(itemId: string, task: () => Promise<MediaItem>): Promise<MediaItem> {
  if (detailRequestThrottle.has(itemId)) return Promise.resolve(itemId.startsWith('pm-') ? { id: itemId, title: 'Premium', duration: 0 } : {} as MediaItem)

  detailRequestThrottle.add(itemId)

  return new Promise((resolve) => {
    detailRequestQueue.push({ id: itemId, resolve })
    if (!isProcessing) {
      isProcessing = true
      processDetailQueue().then(() => {
        isProcessing = false
        const next = detailRequestQueue.shift()
        if (next) processDetailQueue().then(() => {
          isProcessing = false
          // recursively process remaining
          processDetailQueue()
        })
      })
    }
    // Find our resolution in the queue
    const check = setInterval(() => {
      const entry = detailRequestQueue.find((q) => q.id === itemId)
      if (entry?.resolved) {
        clearInterval(check)
        resolve(entry.resolved)
        detailRequestThrottle.delete(itemId)
      }
    }, 50)
    setTimeout(() => {
      clearInterval(check)
      detailRequestThrottle.delete(itemId)
      resolve({ id: itemId, title: 'Loading...', duration: 0 } as MediaItem)
    }, 3000)
  })
}

async function processDetailQueue(): Promise<void> {
  if (detailRequestQueue.length === 0) return
  const { id, resolve } = detailRequestQueue[0]
  try {
    const full = await publicMediaApi.getById(id)
    // Mark all pending requests for this id as resolved
    detailRequestQueue.forEach((q) => {
      if (q.id === id) {
        q.resolve(full)
      }
    })
    // Remove processed items and continue
    detailRequestQueue.splice(0, detailRequestQueue.length)
    // Re-process remaining
    await processDetailQueue()
  } catch (e) {
    console.error('Detail request failed:', e)
    detailRequestQueue.splice(0, detailRequestQueue.length)
    detailRequestThrottle.delete(id)
    await processDetailQueue()
  }
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

  // Use shared grid observer instead of per-card observer
  useEffect(() => {
    if (cardRef.current) {
      gridObserver.observe(cardRef.current as Element)
      ;(cardRef.current as HTMLElement).dataset.onLoad = ''
    }
    return () => gridObserver.disconnect()
  }, [item.id])

  // Detail hydration using throttle
  useEffect(() => {
    setResolved(detailCache.get(item.id) ?? null)
    setThumbnailIndex(0)
    setImageExhausted(false)
    setPreviewFailed(false)
  }, [item.id])

  useEffect(() => {
    if (!inView || resolved || !item.id) return
    void throttleDetailRequest(item.id, () => publicMediaApi.getById(item.id)).then((full) => {
      if (full.id) setResolved(full)
    }).catch(() => undefined)
  }, [inView, item, resolved])

  // Background hydration when in view and not exhausted
  useEffect(() => {
    if (!imageExhausted || resolved || !inView) return
    void throttleDetailRequest(item.id, () => publicMediaApi.getById(item.id)).then((full) => {
      if (full.id) setResolved(full)
    }).catch(() => undefined)
  }, [imageExhausted, inView, item, resolved])

  const isPremium = item.id.startsWith('pm-') || item.id.startsWith('premium-') || item.id.startsWith('hp-') || item.creator === 'premium'
  const requiresDetail = !isPremium && (!item.videoUrl || item.thumbnailUrls.length === 0)
  const display = resolved ?? item
  const saved = isSaved(display.id)
  const thumbnails = useMemo(() => [...new Set((display.thumbnailUrls?.length ? display.thumbnailUrls : (display.thumbnail ? [display.thumbnail] : [])).filter(Boolean))], [display.thumbnail, display.thumbnailUrls])
  const activeThumbnail = !imageExhausted ? thumbnails[thumbnailIndex] : undefined
  const previewSource = /\\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(display.previewUrl ?? display.videoUrlSd ?? display.videoUrl ?? '')
    ? (display.previewUrl ?? display.videoUrlSd ?? display.videoUrl)
    : undefined
  const embedUrl = isPremium ? '' : `https://www.redgifs.com/ifr/${encodeURIComponent(display.id)}?autoplay=1`
  const uncropped = isPremium && isUncroppedImage(display)
  const frameStyle = uncropped ? naturalFrameStyle(display.width, display.height) : {}

  useEffect(() => {
    // Only hydrate once per card enter/view cycle
    if (imageExhausted || resolved || isPremium) return
    void throttleDetailRequest(item.id, () => publicMediaApi.getById(item.id)).then((full) => {
      if (full.id) setResolved(full)
    }).catch(() => undefined)
  }, [imageExhausted, inView, item, resolved])

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

  return (
    <article className="media-card" ref={cardRef}>
      <button
        className={`media-card__visual${activeThumbnail || (previewSource && !previewFailed) ? '' : ' media-card__visual--empty'}${uncropped ? ' media-card__visual--natural' : ''}`}
        style={frameStyle}
        type="button"
        onClick={() => void open()}
        aria-label={`Open ${display.title}`}
      >
        {activeThumbnail ? (
          <img key={activeThumbnail} src={activeThumbnail} alt="" loading={priority ? 'eager' : 'lazy'} decoding="async" onError={nextThumbnail} />
        ) : previewSource && inView && !previewFailed ? (
          <video key={previewSource} src={previewSource} muted playsInline preload="metadata" poster={display.thumbnail} onError={() => setPreviewFailed(true)} />
        ) : previewFailed ? (
          <span className="media-card__missing">Video unavailable</span>
        ) : (
          <span className="media-card__missing">{opening ? 'Opening…' : 'Preview'}</span>
        )}
        <span className="media-card__shade" aria-hidden="true" />
        <span className="media-card__play" aria-hidden="true"><PlayIcon size={18} /></span>
        <span className="media-card__duration">{durationLabel(display.duration)}</span>
        {display.hasAudio && <span className="media-card__audio">Audio</span>}
      </button>

      <div className="media-card__info">
        <div className="media-card__copy">
          <button className="media-card__title" type="button" onClick={() => void open()}>{display.title}</button>
          <button className="media-card__creator" type="button" onClick={() => navigate(`/creator/${encodeURIComponent(display.creator)}`)}>@{display.creator}</button>
        </div>
        <button className={`save-button${saved ? ' is-saved' : ''}`} type="button" aria-label={saved ? `Remove ${display.title} from library` : `Save ${display.title} to library`} onClick={() => toggleSaved(display)}><BookmarkIcon size={17} filled={saved} /></button>
      </div>
      <div className="media-card__meta"><span>{compactNumber(display.views)} views</span><span>{compactNumber(display.likes)} likes</span></div>
    </article>
  )
}