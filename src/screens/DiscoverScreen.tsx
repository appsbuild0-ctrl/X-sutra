import { useCallback, useEffect, useState } from 'react'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { ArrowLeftIcon, ChevronRightIcon, RefreshIcon, SearchIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { demoCreators, demoMedia, demoNiches, demoSearch } from '../lib/demo'
import { compactNumber } from '../lib/format'
import { publicMediaApi } from '../lib/redgifs'
import type { Creator, MediaItem, Niche } from '../types'

export function DiscoverScreen(): React.JSX.Element {
  const { notify } = useApp()
  const [query, setQuery] = useState('')
  const [featured, setFeatured] = useState<MediaItem[]>([])
  const [creators, setCreators] = useState<Creator[]>([])
  const [niches, setNiches] = useState<Niche[]>([])
  const [results, setResults] = useState<MediaItem[] | null>(null)
  const [resultTitle, setResultTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [usingPreview, setUsingPreview] = useState(false)

  const loadExplore = useCallback(async () => {
    setLoading(true)
    const [feedResult, creatorResult, nicheResult] = await Promise.allSettled([
      publicMediaApi.latest(),
      publicMediaApi.creators(),
      publicMediaApi.niches()
    ])

    const feed = feedResult.status === 'fulfilled' && feedResult.value.length ? feedResult.value : demoMedia
    const creatorList = creatorResult.status === 'fulfilled' && creatorResult.value.length ? creatorResult.value : demoCreators
    const nicheList = nicheResult.status === 'fulfilled' && nicheResult.value.length ? nicheResult.value : demoNiches
    setFeatured(feed)
    setCreators(creatorList)
    setNiches(nicheList)
    setUsingPreview(feedResult.status !== 'fulfilled')
    setLoading(false)
  }, [])

  useEffect(() => { void loadExplore() }, [loadExplore])

  const runSearch = async (value: string, title = `Results for “${value.trim()}”`) => {
    const clean = value.trim()
    if (!clean) {
      notify('Type a tag, creator, or topic to search')
      return
    }
    setQuery(clean)
    setSearching(true)
    setResultTitle(title)
    try {
      const found = await publicMediaApi.search(clean)
      setResults(found.length ? found : demoSearch(clean))
      setUsingPreview(found.length === 0)
    } catch {
      setResults(demoSearch(clean))
      setUsingPreview(true)
    } finally {
      setSearching(false)
    }
  }

  const openCreator = async (creator: Creator) => {
    setSearching(true)
    setResultTitle(`@${creator.username}`)
    try {
      const found = await publicMediaApi.creator(creator.username)
      setResults(found.length ? found : demoSearch(creator.username))
      setUsingPreview(found.length === 0)
    } catch {
      setResults(demoSearch(creator.username))
      setUsingPreview(true)
    } finally {
      setSearching(false)
    }
  }

  const clearResults = () => {
    setResults(null)
    setResultTitle('')
    setQuery('')
  }

  const isShowingResults = results !== null || searching

  return (
    <section className="screen">
      <ScreenHeader
        title="Discover"
        eyebrow="Find something new"
        actions={<button className="round-button" type="button" onClick={() => void loadExplore()} aria-label="Refresh discovery"><RefreshIcon size={20} /></button>}
      />

      <form className="search-field" onSubmit={(event) => {
        event.preventDefault()
        void runSearch(query)
      }}>
        <SearchIcon size={20} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search creators, tags, videos…"
          aria-label="Search public media"
          enterKeyHint="search"
        />
        <button type="submit">Search</button>
      </form>

      {isShowingResults ? (
        <div className="discover-results">
          <div className="section-heading section-heading--result">
            <div>
              <p className="eyebrow">Search</p>
              <h3>{resultTitle || 'Looking for clips…'}</h3>
            </div>
            <button className="text-button" type="button" onClick={clearResults}><ArrowLeftIcon size={16} /> Explore</button>
          </div>
          {usingPreview && !searching && <div className="connection-note">Showing local preview results while the live public search reconnects.</div>}
          <MediaGrid
            items={results ?? []}
            loading={searching}
            empty={<div className="empty-state"><strong>No clips found yet.</strong><span>Try a shorter search or choose a topic below.</span></div>}
          />
        </div>
      ) : (
        <>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Start somewhere</p>
              <h3>Browse topics</h3>
            </div>
            <span>Tap to search</span>
          </div>
          <div className="niche-row" aria-label="Trending topics">
            {niches.slice(0, 10).map((niche) => (
              <button key={niche.id} type="button" className="niche-chip" onClick={() => void runSearch(niche.name, niche.name)}>
                {niche.name}<ChevronRightIcon size={14} />
              </button>
            ))}
          </div>

          <div className="section-heading section-heading--spaced">
            <div>
              <p className="eyebrow">People to watch</p>
              <h3>Trending creators</h3>
            </div>
            <span>Public profiles</span>
          </div>
          <div className="creator-list">
            {creators.slice(0, 6).map((creator, index) => (
              <button className="creator-row" type="button" key={creator.username} onClick={() => void openCreator(creator)}>
                <span className="creator-avatar" style={!creator.avatar ? { '--avatar-index': index } as React.CSSProperties : undefined}>
                  {creator.avatar ? <img src={creator.avatar} alt="" /> : creator.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="creator-row__copy">
                  <strong>{creator.displayName}{creator.verified && <i className="verified-dot">✓</i>}</strong>
                  <small>@{creator.username} · {compactNumber(creator.followers)} followers</small>
                </span>
                <ChevronRightIcon size={18} />
              </button>
            ))}
          </div>

          <div className="section-heading section-heading--spaced">
            <div>
              <p className="eyebrow">New in the feed</p>
              <h3>Fresh clips</h3>
            </div>
            {!loading && <span>{featured.length} clips</span>}
          </div>
          {usingPreview && !loading && <div className="connection-note">The app will keep trying the live public feed. All preview controls still work.</div>}
          <MediaGrid items={featured} loading={loading} />
        </>
      )}
    </section>
  )
}
