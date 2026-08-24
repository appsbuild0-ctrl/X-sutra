import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { compactNumber, durationLabel } from '../lib/format'
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

const detailCache = new Map<string, MediaItem>()
const detailRequests = new Map<string, Promise<MediaItem>>()
let activeDetailRequests = 0
const queuedDetailTasks: Array<() => void> = []
const MAX_DETAIL_REQUESTS = 4

function runDetailTask<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeDetailRequests += 1
      void task().then(resolve, reject).finally(() => {
        activeDetailRequests -= 1
        queuedDetailTasks.shift()?.()
      })
    }
    if (activeDetailRequests < MAX_DETAIL_REQUESTS) run()
    else queuedDetailTasks.push(run)
  })
}

async function hydrateMedia(item: MediaItem): Promise<MediaItem> {
  const cached = detailCache.get(item.id)
  if (cached) return cached
  const existing = detailRequests.get(item.id)
  if (existing) return existing
  const request = runDetailTask(() => publicMediaApi.getById(item.id))
    .then((full) => {
      detailCache.set(item.id, full)
      return full
    })
    .finally(() => detailRequests.delete(item.id))
  detailRequests.set(item.id, request)
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

  useEffect(() => {
    setResolved(detailCache.get(item.id) ?? null)
    setThumbnailIndex(0)
    setImageExhausted(false)
    setPreviewFailed(false)
  }, [item.id])

  useEffect(() => {
    const element = cardRef.current
    if (!element || priority || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setInView(true)
        observer.disconnect()
      }
    }, { rootMargin: '260px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [priority, item.id])

  const isPremium = item.id.startsWith('pm-') || item.id.startsWith('premium-') || item.id.startsWith('hp-') || item.creator === 'premium'
  const requiresDetail = !isPremium && (!item.videoUrl || item.thumbnailUrls.length === 0)
  useEffect(() => {
    if (!inView || resolved || !requiresDetail) return
    let cancelled = false
    void hydrateMedia(item).then((full) => { if (!cancelled) setResolved(full) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [inView, item, requiresDetail, resolved])

  const display = resolved ?? item
  const saved = isSaved(display.id)
  const thumbnails = useMemo(() => [...new Set((display.thumbnailUrls?.length ? display.thumbnailUrls : (display.thumbnail ? [display.thumbnail] : [])).filter(Boolean))], [display.thumbnail, display.thumbnailUrls])
  const activeThumbnail = !imageExhausted ? thumbnails[thumbnailIndex] : undefined
  const previewSource = /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(display.previewUrl ?? display.videoUrlSd ?? display.videoUrl ?? '')
    ? (display.previewUrl ?? display.videoUrlSd ?? display.videoUrl)
    : undefined
  const embedUrl = isPremium ? '' : `https://www.redgifs.com/ifr/${encodeURIComponent(display.id)}?autoplay=1`

  useEffect(() => {
    if (!imageExhausted || resolved || !inView || isPremium) return
    let cancelled = false
    void hydrateMedia(item).then((full) => { if (!cancelled) setResolved(full) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [imageExhausted, inView, item, resolved])

  const nextThumbnail = () => {
    if (thumbnailIndex + 1 < thumbnails.length) setThumbnailIndex((current) => current + 1)
    else setImageExhausted(true)
  }

  const open = async () => {
    setOpening(true)
    try {
      const full = item.id.startsWith('hp-')
        ? await hotpicApi.resolve(item)
        : isPremium
          ? item
          : (resolved ?? await hydrateMedia(item).catch(() => item))
      const fullQueue = (queue?.length ? queue : [item]).map((entry) => entry.id === full.id ? full : (detailCache.get(entry.id) ?? entry))
      openPlayer(full, fullQueue)
    } finally {
      setOpening(false)
    }
  }

  return (
    <article className="media-card" ref={cardRef}>
      <button
        className={`media-card__visual${activeThumbnail || (previewSource && !previewFailed) ? '' : ' media-card__visual--empty'}`}
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
