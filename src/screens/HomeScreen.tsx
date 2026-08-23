import { useCallback, useEffect, useMemo, useState } from 'react'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { RefreshIcon, SparkIcon } from '../components/icons'
import { demoMedia } from '../lib/demo'
import { publicMediaApi } from '../lib/redgifs'
import type { FeedMode, MediaItem } from '../types'

type SortMode = 'featured' | 'newest' | 'popular'

function sorted(items: MediaItem[], sort: SortMode): MediaItem[] {
  const copy = [...items]
  if (sort === 'popular') return copy.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
  if (sort === 'newest') return copy.sort((a, b) => b.id.localeCompare(a.id))
  return copy
}

export function HomeScreen(): React.JSX.Element {
  const [mode, setMode] = useState<FeedMode>('trending')
  const [sort, setSort] = useState<SortMode>('featured')
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [usingPreview, setUsingPreview] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const remoteItems = mode === 'trending'
        ? await publicMediaApi.trending()
        : await publicMediaApi.latest()
      if (!remoteItems.length) throw new Error('No public results returned')
      setItems(remoteItems)
      setUsingPreview(false)
    } catch {
      setItems(mode === 'trending' ? demoMedia : [...demoMedia].reverse())
      setUsingPreview(true)
    } finally {
      setLoading(false)
    }
  }, [mode])

  useEffect(() => { void load() }, [load])

  const visibleItems = useMemo(() => sorted(items, sort), [items, sort])

  return (
    <section className="screen screen--home">
      <ScreenHeader
        title="X-sutra"
        eyebrow="Your private viewing space"
        actions={
          <button className="round-button" type="button" onClick={() => void load()} aria-label="Refresh feed">
            <RefreshIcon size={20} />
          </button>
        }
      />

      <div className="home-intro">
        <div>
          <p className="home-intro__kicker"><SparkIcon size={16} /> Public feed</p>
          <h2>{mode === 'trending' ? 'What’s moving now.' : 'Fresh picks for you.'}</h2>
          <p>Browse freely. No external account is required.</p>
        </div>
        <span className="live-pill"><i className={usingPreview ? 'is-preview' : ''} /> {usingPreview ? 'Preview mode' : 'Live'}</span>
      </div>

      <div className="feed-toolbar">
        <div className="segmented" role="tablist" aria-label="Feed selection">
          <button
            className={mode === 'for-you' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={mode === 'for-you'}
            onClick={() => setMode('for-you')}
          >
            For you
          </button>
          <button
            className={mode === 'trending' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={mode === 'trending'}
            onClick={() => setMode('trending')}
          >
            Trending
          </button>
        </div>
        <label className="sort-control">
          <span className="sr-only">Sort feed</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
            <option value="featured">Featured</option>
            <option value="newest">Newest</option>
            <option value="popular">Most liked</option>
          </select>
        </label>
      </div>

      {usingPreview && !loading && (
        <div className="connection-note">
          Live public content is not reachable right now, so X-sutra is showing a local interactive preview. Tap refresh to try again.
        </div>
      )}

      <div className="section-heading">
        <div>
          <p className="eyebrow">{mode === 'trending' ? 'Popular today' : 'Fresh from the public feed'}</p>
          <h3>{mode === 'trending' ? 'Trending now' : 'For your session'}</h3>
        </div>
        {!loading && <span>{visibleItems.length} clips</span>}
      </div>

      <MediaGrid items={visibleItems} loading={loading} />
    </section>
  )
}
