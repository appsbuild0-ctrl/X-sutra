import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CreatorAvatar } from '../components/CreatorAvatar'
import { LiveError, ScreenNotice } from '../components/LiveState'
import { MediaGrid } from '../components/MediaGrid'
import { PullToRefresh } from '../components/PullToRefresh'
import { ScreenHeader } from '../components/ScreenHeader'
import { ChevronRightIcon, RefreshIcon, SearchIcon } from '../components/icons'
import { compactNumber } from '../lib/format'
import { isRedgifsVideo, publicMediaApi } from '../lib/redgifs'
import type { Creator, Niche } from '../types'
import { usePagedMedia } from '../hooks/usePagedMedia'

export function DiscoverScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [creators, setCreators] = useState<Creator[]>([])
  const [niches, setNiches] = useState<Niche[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [metaLoading, setMetaLoading] = useState(true)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [firstApiPage, setFirstApiPage] = useState(1)
  const feed = usePagedMedia(useCallback(async (logicalPage: number) => {
    const response = await publicMediaApi.latest(firstApiPage + logicalPage - 1)
    return { ...response, page: logicalPage, pages: Math.max(logicalPage, response.pages > firstApiPage ? response.pages - firstApiPage + 1 : logicalPage) }
  }, [firstApiPage]), [firstApiPage])

  const loadMetadata = useCallback(async () => {
    setMetaLoading(true)
    setMetaError(null)
    try {
      const [creatorResult, nicheResult, categoryResult] = await Promise.all([
        publicMediaApi.creators(),
        publicMediaApi.niches(),
        publicMediaApi.categories()
      ])
      setCreators(creatorResult)
      setNiches(nicheResult)
      setCategories(categoryResult)
    } catch (reason) {
      setMetaError(reason instanceof Error ? reason.message : 'Unable to load public discovery data.')
    } finally {
      setMetaLoading(false)
    }
  }, [])

  useEffect(() => { void loadMetadata() }, [loadMetadata])

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const clean = query.trim()
    if (clean) navigate(`/search/${encodeURIComponent(clean)}`)
  }

  const refresh = async () => {
    setFirstApiPage((current) => current >= 7 ? 1 : current + 1)
    await loadMetadata()
  }

  return (
    <PullToRefresh onRefresh={refresh}>
      <section className="screen">
      <ScreenHeader
        title="Discover"
        eyebrow="Live public index"
        actions={<button className="round-button" type="button" onClick={refresh} aria-label="Refresh discovery"><RefreshIcon size={20} /></button>}
      />

      <form className="search-field" onSubmit={submitSearch}>
        <SearchIcon size={20} />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search creators, tags, videos…" aria-label="Search public media" enterKeyHint="search" />
        <button type="submit">Search</button>
      </form>

      {metaError && <ScreenNotice>Some discovery data could not load. Feed search remains available. <button type="button" onClick={() => void loadMetadata()}>Retry</button></ScreenNotice>}

      <div className="section-heading section-heading--spaced">
        <div>
          <p className="eyebrow">Public discovery</p>
          <h3>Trending niches</h3>
        </div>
        {!metaLoading && <span>{niches.length} niches</span>}
      </div>
      {metaLoading ? <div className="chip-skeleton-row"><i /><i /><i /><i /></div> : niches.length ? (
        <div className="niche-row" aria-label="Trending niches">
          {niches.slice(0, 12).map((niche) => (
            <button key={niche.id} type="button" className="niche-chip" onClick={() => navigate(`/niche/${encodeURIComponent(niche.id)}`)}>
              {niche.name}<ChevronRightIcon size={14} />
            </button>
          ))}
        </div>
      ) : <ScreenNotice>No public niches are available right now.</ScreenNotice>}

      <div className="section-heading section-heading--spaced">
        <div>
          <p className="eyebrow">Browse by tag</p>
          <h3>Categories</h3>
        </div>
      </div>
      {categories.length ? (
        <div className="category-grid">
          {categories.slice(0, 20).map((category) => <button type="button" key={category} onClick={() => navigate(`/tag/${encodeURIComponent(category)}`)}>#{category}</button>)}
        </div>
      ) : !metaLoading && <ScreenNotice>Categories are not available from the public endpoint right now.</ScreenNotice>}

      <div className="section-heading section-heading--spaced">
        <div>
          <p className="eyebrow">Public profiles</p>
          <h3>Trending creators</h3>
        </div>
        {!metaLoading && <span>{creators.length} creators</span>}
      </div>
      {metaLoading ? <div className="creator-loading"><i /><i /><i /></div> : creators.length ? (
        <div className="creator-list">
          {creators.slice(0, 12).map((creator, index) => (
            <button className="creator-row" type="button" key={creator.username} onClick={() => navigate(`/creator/${encodeURIComponent(creator.username)}`)}>
              <CreatorAvatar src={creator.avatar} label={creator.displayName} index={index} />
              <span className="creator-row__copy">
                <strong>{creator.displayName}{creator.verified && <i className="verified-dot">✓</i>}</strong>
                <small>@{creator.username} · {compactNumber(creator.followers)} followers</small>
              </span>
              <ChevronRightIcon size={18} />
            </button>
          ))}
        </div>
      ) : !metaError && <ScreenNotice>No public creators are available right now.</ScreenNotice>}

      <div className="section-heading section-heading--spaced">
        <div>
          <p className="eyebrow">Live V2 index</p>
          <h3>Fresh clips</h3>
        </div>
      </div>
      {feed.error ? <LiveError message={feed.error} onRetry={feed.reload} /> : (
        <MediaGrid items={feed.items} loading={feed.loading} canLoadMore={feed.canLoadMore} loadingMore={feed.loadingMore} onLoadMore={() => void feed.loadMore()} empty={<div className="empty-state"><strong>No fresh public clips found.</strong></div>} />
      )}
      </section>
    </PullToRefresh>
  )
}
