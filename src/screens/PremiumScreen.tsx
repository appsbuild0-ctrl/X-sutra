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
  { id: 'albums', label: 'ALBUMS' },
  { id: 'discover', label: 'DISCOVER' },
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
  const [heroIndex, setHeroIndex] = useState(0)

  useEffect(() => {
    let live = true
    void fetchPremiumCatalog().then((next) => { if (live) setCatalog(next) }).catch((reason) => {
      if (live) setError(reason instanceof Error ? reason.message : 'Premium could not load.')
    })
    return () => { live = false }
  }, [])

  useEffect(() => {
    const heroes = catalog?.heroes ?? []
    if (heroes.length < 2) return
    const timer = window.setInterval(() => setHeroIndex((current) => (current + 1) % heroes.length), 5000)
    return () => window.clearInterval(timer)
  }, [catalog?.heroes])

  useEffect(() => {
    if (!catalog?.settings.newVideoNotifications) {
      setNewVideos([])
      return
    }
    let live = true
    void publicMediaApi.latest(1).then((page) => {
      if (!live) return
      const seen = new Set(readStored<string[]>(SEEN_KEY, []))
      setNewVideos(page.items.filter((item) => !seen.has(item.id)))
    }).catch(() => { if (live) setNewVideos([]) })
    return () => { live = false }
  }, [catalog?.settings.newVideoNotifications])

  const videos = useMemo(() => (catalog?.media ?? []).filter((item) => item.type === 'video'), [catalog])
  const images = useMemo(() => (catalog?.media ?? []).filter((item) => item.type === 'image'), [catalog])
  const albums = catalog?.albums ?? []
  const channels = catalog?.channels ?? []
  const heroes = catalog?.heroes ?? []
  const results = useMemo(() => searchPremium(catalog ?? emptyCatalog(), query), [catalog, query])
  const setTab = (next: TabId) => setParams(next === 'home' ? {} : { tab: next })
  const hero = heroes[heroIndex] ?? heroes[0]

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

      {hero && (
        <div className="premium-hero-stage" style={{ backgroundImage: `url(${hero.thumbnail || hero.url})` }}>
          <div>
            <p className="eyebrow">Premium poster</p>
            <h2>{hero.title || 'X-sutra Premium'}</h2>
          </div>
          {heroes.length > 1 && <small>{heroIndex + 1}/{heroes.length}</small>}
        </div>
      )}

      <div className="section-heading"><div><p className="eyebrow">Categories</p><h3>Channels</h3></div></div>
      {channels.length ? (
        <div className="niche-row" aria-label="Premium channels">
          {channels.map((channel) => (
            <button key={channel.id} type="button" className="niche-chip" onClick={() => navigate(`/premium/channel/${channel.id}`)}>{channel.name}</button>
          ))}
        </div>
      ) : <p className="form-help">No premium channels yet.</p>}

      <div className="premium-tabs" role="tablist" aria-label="Premium sections">
        {TABS.map((entry) => (
          <button key={entry.id} className={tab === entry.id ? 'is-active' : ''} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => setTab(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>

      {error && <LiveError message={error} onRetry={() => { setError(null); void fetchPremiumCatalog().then(setCatalog) }} />}
      {!catalog && !error && <div className="media-grid">{Array.from({ length: 4 }, (_, index) => <div className="media-skeleton" key={index} />)}</div>}

      {catalog && tab === 'home' && (
        <>
          {catalog.settings.newVideoNotifications && newVideos.length > 0 && (
            <button className="premium-notice" type="button" onClick={openNewVideos}>
              <span>🔔 New Videos</span>
              <strong>{newVideos.length} new video{newVideos.length === 1 ? '' : 's'} available</strong>
              <small>Public feed — not copied into Premium</small>
            </button>
          )}
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Latest</p><h3>Premium albums</h3></div></div>
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
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Latest</p><h3>Premium images</h3></div></div>
          <ImageStrip items={images.slice(0, 8)} />
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Latest</p><h3>Premium videos</h3></div></div>
          <MediaGrid items={videos.slice(0, 8).map(premiumMediaToItem)} empty={<p className="form-help">No premium videos yet.</p>} />
        </>
      )}

      {catalog && tab === 'reels' && (
        <MediaGrid items={videos.map(premiumMediaToItem)} empty={<div className="empty-state"><strong>No premium reels yet.</strong></div>} />
      )}

      {catalog && tab === 'albums' && (
        albums.length ? (
          <div className="premium-album-grid">
            {albums.map((album) => (
              <button key={album.id} className="premium-album" type="button" onClick={() => navigate(`/premium/album/${album.id}`)}>
                <span className="premium-album__cover" style={album.cover ? { backgroundImage: `url(${album.cover})` } : undefined} />
                <strong>{album.name}</strong>
                <small>{album.description || album.tags.join(', ')}</small>
              </button>
            ))}
          </div>
        ) : <div className="empty-state"><strong>No premium albums yet.</strong></div>
      )}

      {catalog && tab === 'discover' && (
        <>
          <form className="search-field" onSubmit={(event) => event.preventDefault()}>
            <SearchIcon size={20} />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Premium..." aria-label="Search Premium" />
          </form>
          {query.trim() && !results.albums.length && !results.media.length && !results.channels.length && <div className="empty-state"><strong>No results found</strong></div>}
          {results.channels.length > 0 && <div className="category-grid">{results.channels.map((channel) => <button type="button" key={channel.id} onClick={() => navigate(`/premium/channel/${channel.id}`)}>{channel.name}</button>)}</div>}
          {results.albums.length > 0 && (
            <div className="premium-album-grid">
              {results.albums.map((album) => (
                <button key={album.id} className="premium-album" type="button" onClick={() => navigate(`/premium/album/${album.id}`)}>
                  <span className="premium-album__cover" style={album.cover ? { backgroundImage: `url(${album.cover})` } : undefined} />
                  <strong>{album.name}</strong>
                  <small>{album.description}</small>
                </button>
              ))}
            </div>
          )}
          <MediaGrid items={results.media.filter((item) => item.type === 'video').map(premiumMediaToItem)} empty={null} />
          <ImageStrip items={results.media.filter((item) => item.type === 'image')} />
        </>
      )}

      {catalog && tab === 'announcements' && (
        catalog.announcements.length ? (
          <div className="premium-announcements">
            {catalog.announcements.map((item) => (
              <button
                key={item.id}
                className="premium-announcement"
                type="button"
                onClick={() => {
                  if (item.kind === 'album' && item.target) navigate(`/premium/album/${item.target}`)
                  else if (item.kind === 'channel' && item.target) navigate(`/premium/channel/${item.target}`)
                  else if (item.kind === 'video') setTab('reels')
                  else if (item.kind === 'photos') setTab('home')
                }}
              >
                <strong>📢 {item.title}</strong>
                <p>{item.detail}</p>
                <small>{new Date(item.createdAt).toLocaleString('en-IN')}</small>
              </button>
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
