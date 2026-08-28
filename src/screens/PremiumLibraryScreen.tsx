import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MediaGrid } from '../components/MediaGrid'
import { PremiumImageTile } from '../components/PremiumImageTile'
import { ScreenHeader } from '../components/ScreenHeader'
import { XIcon } from '../components/icons'
import { discordFeedItemToMedia, useDiscordFeed } from '../lib/discordFeed'
import { naturalFrameStyle } from '../lib/imageFit'

/**
 * Premium library — everything Discord delivered.
 *
 * Media here is not uploaded a second time: it is the Discord attachment,
 * streamed from the Discord CDN through the same-origin resolver. The screen
 * polls the feed, so a file forwarded into a mapped channel appears by itself.
 */
export function PremiumLibraryScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const feed = useDiscordFeed({ pageSize: 24 })
  const [lightbox, setLightbox] = useState<number | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const images = useMemo(() => feed.items.filter((item) => item.type === 'image'), [feed.items])
  const videos = useMemo(() => feed.items.filter((item) => item.type === 'video').map(discordFeedItemToMedia), [feed.items])

  useEffect(() => {
    if (!feed.hasMore || feed.loadingMore || !sentinelRef.current || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) feed.loadMore()
    }, { rootMargin: '900px 0px' })
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [feed])

  const open = (index: number) => setLightbox(index)

  return (
    <section className="screen screen--ott">
      <ScreenHeader
        title="Library"
        eyebrow={feed.refreshing ? 'Checking Discord…' : 'Live from Discord'}
        actions={<button className="round-button" type="button" onClick={() => navigate('/premium')} aria-label="Back">‹</button>}
      />

      {!feed.configured && (
        <div className="premium-notice premium-notice--soft">
          <span>Discord not configured</span>
          <strong>Bot token aur guild id server pe set karo</strong>
          <small>Admin Panel → Discord me channel mapping ke baad yahan media apne aap aayega.</small>
        </div>
      )}

      {feed.sections.length > 0 && (
        <div className="discord-sections">
          {feed.sections.map((section) => (
            <button key={section.channelId || section.discordChannelId} type="button" className="discord-section" onClick={() => section.channelId && navigate(`/premium/channel/${section.channelId}`)}>
              <strong>{section.name || `#${section.discordChannelId}`}</strong>
              <small>{section.count} media · {section.kinds.join(' + ')}</small>
              {section.lastSyncAt && <small className="discord-section__sync">synced {new Date(section.lastSyncAt).toLocaleTimeString('en-IN')}</small>}
            </button>
          ))}
        </div>
      )}

      {feed.error && <div className="empty-state"><strong>{feed.error}</strong><button className="secondary-button" type="button" onClick={feed.refresh}>Retry</button></div>}

      {!feed.loading && !feed.error && !feed.items.length && (
        <div className="empty-state">
          <strong>{feed.configured ? 'No Discord media yet' : 'Library is empty'}</strong>
          <p className="form-help">
            {feed.configured
              ? 'Mapped Discord channel me koi image ya video forward karo — wo yahan apne aap aa jayega.'
              : 'Discord configured hone ke baad mapped channels ka media yahan dikhega.'}
          </p>
          <button className="secondary-button" type="button" onClick={feed.refresh}>Check now</button>
        </div>
      )}

      {feed.loading && <div className="media-grid">{Array.from({ length: 6 }, (_, index) => <div className="media-skeleton" key={index} />)}</div>}

      {!feed.loading && videos.length > 0 && (
        <>
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Videos</p><h3>From Discord</h3></div></div>
          <MediaGrid items={videos} />
        </>
      )}

      {!feed.loading && images.length > 0 && (
        <>
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Images</p><h3>From Discord</h3></div></div>
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

      {feed.hasMore && (
        <div className="feed-sentinel" ref={sentinelRef} aria-live="polite">
          {feed.loadingMore ? <span className="feed-sentinel__loading">Loading more…</span> : <span className="feed-sentinel__ready">Keep scrolling for more</span>}
        </div>
      )}

      {lightbox !== null && images[lightbox] && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <div className="lightbox__inner" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="lightbox__close" onClick={() => setLightbox(null)} aria-label="Close"><XIcon size={24} /></button>
            <button type="button" className="lightbox__prev" disabled={lightbox === 0} onClick={() => setLightbox(lightbox - 1)} aria-label="Previous">‹</button>
            <img src={images[lightbox].url} alt={images[lightbox].title} className="lightbox__img" style={naturalFrameStyle(images[lightbox].width, images[lightbox].height)} />
            <button type="button" className="lightbox__next" disabled={lightbox >= images.length - 1} onClick={() => setLightbox(lightbox + 1)} aria-label="Next">›</button>
            <div className="lightbox__counter">{lightbox + 1} / {images.length}</div>
          </div>
        </div>
      )}
    </section>
  )
}
