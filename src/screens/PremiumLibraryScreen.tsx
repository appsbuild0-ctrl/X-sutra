import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MediaGrid } from '../components/MediaGrid'
import { PremiumImageTile } from '../components/PremiumImageTile'
import { ScreenHeader } from '../components/ScreenHeader'
import { XIcon } from '../components/icons'
import { discordFeedItemToMedia, useDiscordFeed } from '../lib/discordFeed'
import { fetchPremiumCatalog, premiumMediaToItem, type PremiumCatalog } from '../lib/premium'
import { naturalFrameStyle } from '../lib/imageFit'
import type { MediaItem } from '../types'

/**
 * Premium library — everything from Discord, automatically.
 *
 * Images/videos posted in the x-sutra Discord server are pulled in by the
 * bot (auto-sync, no upload, no mapping) and appear here by themselves:
 * one section per channel, newest first. Media the admin stored directly
 * in the premium catalog shows up alongside it.
 */
export function PremiumLibraryScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const feed = useDiscordFeed({ pageSize: 24 })
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void fetchPremiumCatalog().then(setCatalog)
  }, [])

  // Feed media (live from Discord) + stored catalog media, deduped by id.
  const media = useMemo(() => {
    const seen = new Map<string, MediaItem>()
    for (const item of (catalog?.media ?? []).map(premiumMediaToItem)) seen.set(item.id, item)
    for (const item of feed.items) {
      const mediaItem = discordFeedItemToMedia(item)
      if (!seen.has(mediaItem.id)) seen.set(mediaItem.id, mediaItem)
    }
    return [...seen.values()]
  }, [catalog, feed.items])

  const videos = useMemo(() => media.filter((item) => item.videoUrl || item.type === 'video'), [media])
  const feedImages = useMemo(() => feed.items.filter((item) => item.type === 'image'), [feed.items])
  const storedImages = useMemo(
    () => (catalog?.media ?? []).filter((item) => item.type === 'image'),
    [catalog]
  )
  // One list drives both grids and the lightbox: feed images first, then stored.
  const allImages = useMemo(() => [
    ...feedImages.map((item) => ({ id: item.id, url: item.thumbnail || item.url, title: item.title, width: item.width, height: item.height })),
    ...storedImages.map((item) => ({ id: item.id, url: item.thumbnail || item.url, title: item.title, width: item.width, height: item.height }))
  ], [feedImages, storedImages])

  useEffect(() => {
    if (!feed.hasMore || feed.loadingMore || !sentinelRef.current || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) feed.loadMore()
    }, { rootMargin: '900px 0px' })
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [feed])

  const open = (index: number) => setLightbox(index)
  const hasContent = media.length > 0 || feedImages.length > 0 || storedImages.length > 0

  return (
    <section className="screen screen--ott">
      <ScreenHeader
        title="Library"
        eyebrow={feed.refreshing ? 'Checking Discord…' : 'Live from Discord'}
        actions={<button className="round-button" type="button" onClick={() => navigate('/premium')} aria-label="Back">‹</button>}
      />

      {!feed.configured && (
        <div className="premium-notice premium-notice--soft">
          <span>Discord connect hone wala hai</span>
          <strong>Server pe DISCORD_BOT_TOKEN set karo</strong>
          <small>Bot x-sutra server me join karne ke baad, yahan media apne aap aa jayega — bina kisi mapping ke.</small>
        </div>
      )}

      {feed.syncError && feed.configured && <p className="form-help" style={{ color: '#ffb4a2' }}>Discord sync: {feed.syncError}</p>}

      {feed.sections.length > 0 && (
        <div className="library-sections">
          {feed.sections.map((section) => (
            <button key={section.channelId || section.discordChannelId} type="button" className="library-section" onClick={() => section.channelId && navigate(`/premium/channel/${section.channelId}`)}>
              <strong>{section.name || `#${section.discordChannelId}`}</strong>
              <small>{section.count} media · {section.kinds.join(' + ')}</small>
              {section.lastSyncAt && <small>synced {new Date(section.lastSyncAt).toLocaleTimeString('en-IN')}</small>}
            </button>
          ))}
        </div>
      )}

      {feed.error && <div className="empty-state"><strong>{feed.error}</strong><button className="secondary-button" type="button" onClick={feed.refresh}>Retry</button></div>}

      {!feed.loading && !feed.error && !hasContent && (
        <div className="empty-state">
          <strong>Abhi media nahi aaya</strong>
          <p className="form-help">
            Apne x-sutra Discord server me koi bhi channel me image ya video daalo —
            wo 1 minute ke andar yahan apne aap dikhega.
          </p>
          <button className="secondary-button" type="button" onClick={feed.refresh}>Check now</button>
        </div>
      )}

      {feed.loading && <div className="media-grid">{Array.from({ length: 6 }, (_, index) => <div className="media-skeleton" key={index} />)}</div>}

      {!feed.loading && videos.length > 0 && (
        <>
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Videos</p><h3>Latest</h3></div></div>
          <MediaGrid items={videos} />
        </>
      )}

      {!feed.loading && feedImages.length > 0 && (
        <>
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Images</p><h3>From Discord</h3></div></div>
          <div className="premium-image-grid">
            {feedImages.map((item, index) => (
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

      {!feed.loading && storedImages.length > 0 && (
        <>
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Images</p><h3>Stored</h3></div></div>
          <div className="premium-image-grid">
            {storedImages.map((item, index) => (
              <PremiumImageTile
                key={item.id}
                url={item.thumbnail || item.url}
                title={item.title}
                width={item.width}
                height={item.height}
                onOpen={() => open(feedImages.length + index)}
              />
            ))}
          </div>
        </>
      )}

      {feed.hasMore && (
        <div className="feed-sentinel" ref={sentinelRef} aria-live="polite">
          {feed.loadingMore ? <span className="feed-sentinel__loading">Loading more…</span> : <span className="feed-sentinel__ready">Keep scrolling for more</span>}
        </div>
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
