import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LiveError } from '../components/LiveState'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { SearchIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { publicMediaApi } from '../lib/redgifs'
import { emptyCatalog, fetchPremiumCatalog, premiumMediaToItem, searchPremium, type PremiumCatalog } from '../lib/premium'
import { readStored, writeStored } from '../lib/storage'
import type { MediaItem } from '../types'

const TABS = [
  { id: 'home', label: 'HOME' },
  { id: 'reels', label: 'REELS' },
  { id: 'discover', label: 'DISCOVER' },
  { id: 'categories', label: 'CATEGORIES' },
  { id: 'announcements', label: 'ANNOUNCEMENTS' }
] as const

type TabId = typeof TABS[number]['id']
const SEEN_KEY = 'x-sutra.seen.public.videos.v1'

function isTab(value: string | null): value is TabId {
  return TABS.some((tab) => tab.id === value)
}

export function PremiumScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: TabId = isTab(params.get('tab')) ? params.get('tab') as TabId : 'home'
  const { openPlayer } = useApp()
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [newVideos, setNewVideos] = useState<MediaItem[]>([])

  useEffect(() => {
    let live = true
    void fetchPremiumCatalog().then((next) => { if (live) setCatalog(next) }).catch((reason) => {
      if (live) setError(reason instanceof Error ? reason.message : 'Premium could not load.')
    })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!catalog?.settings.newVideoNotifications) {
      setNewVideos([])
      return
    }
    let live = true
    void publicMediaApi.latest(1).then((page) => {
      if (!live) return
      const seen = new Set(readStored<string[]>(SEEN_KEY, []))
      const fresh = page.items.filter((item) => !seen.has(item.id))
      setNewVideos(fresh)
    }).catch(() => { if (live) setNewVideos([]) })
    return () => { live = false }
  }, [catalog?.settings.newVideoNotifications])

  const videos = useMemo(() => (catalog?.media ?? []).filter((item) => item.type === 'video'), [catalog])
  const images = useMemo(() => (catalog?.media ?? []).filter((item) => item.type === 'image'), [catalog])
  const albums = catalog?.albums ?? []
  const channels = catalog?.channels ?? []
  const results = useMemo(() => searchPremium(catalog ?? emptyCatalog(), query), [catalog, query])

  const setTab = (next: TabId) => setParams(next === 'home' ? {} : { tab: next })

  const openNewVideos = () => {
    const seen = new Set(readStored<string[]>(SEEN_KEY, []))
    newVideos.forEach((item) => seen.add(item.id))
    writeStored(SEEN_KEY, [...seen].slice(-400))
    if (newVideos[0]) openPlayer(newVideos[0], newVideos)
    else navigate('/')
  }

  return (
    <section className="screen screen--premium">
      <ScreenHeader title="Premium" eyebrow="Exclusive section" actions={<button className="round-button" type="button" onClick={() => navigate(-1)} aria-label="Go back">‹</button>} />

      <div className="premium-tabs" role="tablist" aria-label="Premium sections">
        {TABS.map((entry) => (
          <button key={entry.id} className={tab === entry.id ? 'is-active' : ''} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => setTab(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>

      {error && <LiveError message={error} onRetry={() => { setError(null); void fetchPremiumCatalog().then(setCatalog) }} />}
      {!catalog && !error && <div className="media-grid" aria-label="Loading premium">{Array.from({ length: 4 }, (_, index) => <div className="media-skeleton" key={index} />)}</div>}

      {catalog && tab === 'home' && (
        <>
          {catalog.settings.newVideoNotifications && newVideos.length > 0 && (
            <button className="premium-notice" type="button" onClick={openNewVideos}>
              <span>🔔 New Videos</span>
              <strong>{newVideos.length} new video{newVideos.length === 1 ? '' : 's'} available</strong>
              <small>From the live public feed — tap to watch</small>
            </button>
          )}
          {catalog.announcements[0] && (
            <button className="premium-notice premium-notice--soft" type="button" onClick={() => setTab('announcements')}>
              <span>📢 Latest</span>
              <strong>{catalog.announcements[0].title}</strong>
              <small>{catalog.announcements[0].detail}</small>
            </button>
          )}
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Latest</p><h3>Premium albums</h3></div><span>{albums.length}</span></div>
          {albums.length ? (
            <div className="premium-album-grid">
              {albums.slice(0, 8).map((album) => (
                <button key={album.id} className="premium-album" type="button" onClick={() => navigate(`/premium/album/${album.id}`)}>
                  <span className="premium-album__cover" style={album.cover ? { backgroundImage: `url(${album.cover})` } : undefined} />
                  <strong>{album.name}</strong>
                  <small>{album.description || 'Album'}</small>
                </button>
              ))}
            </div>
          ) : <p className="form-help">No premium albums yet.</p>}
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Latest</p><h3>Premium images</h3></div><span>{images.length}</span></div>
          <ImageStrip items={images.slice(0, 8)} />
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Latest</p><h3>Premium videos</h3></div><span>{videos.length}</span></div>
          <MediaGrid items={videos.slice(0, 8).map(premiumMediaToItem)} empty={<p className="form-help">No premium videos yet.</p>} />
        </>
      )}

      {catalog && tab === 'reels' && (
        <MediaGrid
          items={videos.map(premiumMediaToItem)}
          empty={<div className="empty-state"><strong>No premium reels yet.</strong><span>Admin can import or publish videos into Premium.</span></div>}
        />
      )}

      {catalog && tab === 'discover' && (
        <>
          <form className="search-field" onSubmit={(event) => event.preventDefault()}>
            <SearchIcon size={20} />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search albums, videos, categories..." aria-label="Search Premium" />
          </form>
          {query.trim() && !results.albums.length && !results.media.length && !results.channels.length && (
            <div className="empty-state"><strong>No results found</strong></div>
          )}
          {results.channels.length > 0 && (
            <>
              <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Channels</p><h3>Matches</h3></div></div>
              <div className="category-grid">{results.channels.map((channel) => <button type="button" key={channel.id} onClick={() => navigate(`/premium/channel/${channel.id}`)}>{channel.name}</button>)}</div>
            </>
          )}
          {results.albums.length > 0 && (
            <>
              <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Albums</p><h3>Matches</h3></div></div>
              <div className="premium-album-grid">
                {results.albums.map((album) => (
                  <button key={album.id} className="premium-album" type="button" onClick={() => navigate(`/premium/album/${album.id}`)}>
                    <span className="premium-album__cover" style={album.cover ? { backgroundImage: `url(${album.cover})` } : undefined} />
                    <strong>{album.name}</strong>
                    <small>{album.description}</small>
                  </button>
                ))}
              </div>
            </>
          )}
          {results.media.length > 0 && (
            <>
              <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Media</p><h3>Matches</h3></div></div>
              <MediaGrid items={results.media.filter((item) => item.type === 'video').map(premiumMediaToItem)} empty={null} />
              <ImageStrip items={results.media.filter((item) => item.type === 'image')} />
            </>
          )}
        </>
      )}

      {catalog && tab === 'categories' && (
        channels.length ? (
          <div className="premium-channel-list">
            {channels.map((channel) => (
              <button key={channel.id} className="premium-channel" type="button" onClick={() => navigate(`/premium/channel/${channel.id}`)}>
                <span className="premium-channel__cover" style={channel.cover ? { backgroundImage: `url(${channel.cover})` } : undefined} />
                <span>
                  <strong>{channel.name}</strong>
                  <small>{channel.description || channel.type}</small>
                </span>
                <i>›</i>
              </button>
            ))}
          </div>
        ) : <div className="empty-state"><strong>No channels yet.</strong><span>Admin creates channels inside Premium management.</span></div>
      )}

      {catalog && tab === 'announcements' && (
        catalog.announcements.length ? (
          <div className="premium-announcements">
            {catalog.announcements.map((item) => (
              <article key={item.id} className="premium-announcement">
                <strong>📢 {item.title}</strong>
                <p>{item.detail}</p>
                <small>{new Date(item.createdAt).toLocaleString('en-IN')}</small>
              </article>
            ))}
          </div>
        ) : <div className="empty-state"><strong>No announcements yet.</strong></div>
      )}
    </section>
  )
}

function ImageStrip({ items }: { items: { id: string; url: string; title: string; thumbnail?: string }[] }): React.JSX.Element | null {
  if (!items.length) return <p className="form-help">No premium images yet.</p>
  return (
    <div className="premium-image-grid">
      {items.map((item) => (
        <a key={item.id} className="premium-image" href={item.url} target="_blank" rel="noreferrer" style={{ backgroundImage: `url(${item.thumbnail || item.url})` }} aria-label={item.title} />
      ))}
    </div>
  )
}
