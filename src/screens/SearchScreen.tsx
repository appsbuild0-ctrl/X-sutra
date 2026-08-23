import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CreatorAvatar } from '../components/CreatorAvatar'
import { LiveError, ScreenNotice } from '../components/LiveState'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { ArrowLeftIcon, ChevronRightIcon, SearchIcon } from '../components/icons'
import { compactNumber } from '../lib/format'
import { publicMediaApi } from '../lib/redgifs'
import type { Creator, TagSuggestion } from '../types'
import { usePagedMedia } from '../hooks/usePagedMedia'

export function SearchScreen(): React.JSX.Element {
  const { query: encodedQuery = '' } = useParams()
  const query = decodeURIComponent(encodedQuery)
  const navigate = useNavigate()
  const [value, setValue] = useState(query)
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([])
  const [creators, setCreators] = useState<Creator[]>([])
  const [creatorError, setCreatorError] = useState<string | null>(null)
  const feed = usePagedMedia(useCallback((page: number) => publicMediaApi.search(query, page), [query]), [query])

  useEffect(() => { setValue(query) }, [query])

  useEffect(() => {
    let cancelled = false
    const timeout = window.setTimeout(() => {
      void publicMediaApi.suggestions(query)
        .then((items) => { if (!cancelled) setSuggestions(items) })
        .catch(() => { if (!cancelled) setSuggestions([]) })
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [query])

  useEffect(() => {
    let cancelled = false
    setCreatorError(null)
    void publicMediaApi.creators(query)
      .then((items) => { if (!cancelled) setCreators(items) })
      .catch((reason) => { if (!cancelled) setCreatorError(reason instanceof Error ? reason.message : 'Creator search failed.') })
    return () => { cancelled = true }
  }, [query])

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const clean = value.trim()
    if (clean) navigate(`/search/${encodeURIComponent(clean)}`)
  }

  return (
    <section className="screen">
      <ScreenHeader
        title="Search"
        eyebrow="Public V2 search"
        actions={<button className="round-button" type="button" onClick={() => navigate('/discover')} aria-label="Back to Discover"><ArrowLeftIcon size={20} /></button>}
      />

      <form className="search-field" onSubmit={submit}>
        <SearchIcon size={20} />
        <input type="search" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Search creators, tags, videos…" aria-label="Search public media" autoFocus enterKeyHint="search" />
        <button type="submit">Search</button>
      </form>

      {suggestions.length > 0 && (
        <div className="search-suggestions" aria-label="Tag suggestions">
          {suggestions.slice(0, 8).map((suggestion) => (
            <button type="button" key={suggestion.text} onClick={() => navigate(`/tag/${encodeURIComponent(suggestion.text)}`)}>#{suggestion.text} <small>{compactNumber(suggestion.gifs)}</small></button>
          ))}
        </div>
      )}

      <div className="section-heading section-heading--spaced">
        <div>
          <p className="eyebrow">Query</p>
          <h3>“{query}”</h3>
        </div>
        <button className="text-button" type="button" onClick={() => void feed.reload()}>Refresh</button>
      </div>

      {creators.length > 0 && (
        <>
          <div className="subsection-heading">Creator results</div>
          <div className="creator-list creator-list--compact">
            {creators.slice(0, 6).map((creator, index) => (
              <button className="creator-row" type="button" key={creator.username} onClick={() => navigate(`/creator/${encodeURIComponent(creator.username)}`)}>
                <CreatorAvatar src={creator.avatar} label={creator.displayName} index={index} />
                <span className="creator-row__copy"><strong>{creator.displayName}</strong><small>@{creator.username} · {compactNumber(creator.followers)} followers</small></span>
                <ChevronRightIcon size={18} />
              </button>
            ))}
          </div>
        </>
      )}
      {creatorError && <ScreenNotice>Creator results are temporarily unavailable.</ScreenNotice>}

      <div className="subsection-heading subsection-heading--spaced">Video results</div>
      {feed.error ? <LiveError message={feed.error} onRetry={feed.reload} title="Search could not load live data." /> : (
        <MediaGrid items={feed.items} loading={feed.loading} canLoadMore={feed.canLoadMore} loadingMore={feed.loadingMore} onLoadMore={() => void feed.loadMore()} empty={<div className="empty-state"><strong>No public matches found.</strong><span>Try a shorter tag, title, or creator name.</span></div>} />
      )}
    </section>
  )
}
