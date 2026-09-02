import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaItem, PageResult } from '../types'

interface PagedMediaState {
  items: MediaItem[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  canLoadMore: boolean
  reload: () => Promise<void>
  loadMore: () => Promise<void>
  mergeFresh: () => Promise<void>
}

/** Get a deterministic daily seed based on current date */
function getDailySeed(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Shuffle array deterministically using daily seed */
function deterministicShuffle<T>(array: T[], seed: string): T[] {
  // Create a hash from the seed string
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash | 0 // Convert to 32bit integer
  }

  // Use hash to create a repeatable random sequence
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    // Deterministic random index based on hash
    let randomIndex = 0
    for (let j = 0; j < 32; j++) {
      randomIndex = (randomIndex * 16777619) ^ ((hash >> j) & 1)
    }
    randomIndex = Math.abs(randomIndex) % (i + 1)
    
    ;[shuffled[i], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[i]]
  }
  return shuffled
}

/** Shared real-data pagination with stale-request protection and daily rotation. */
export function usePagedMedia(
  loader: (page: number, dailySeed?: string) => Promise<PageResult<MediaItem>>,
  dependencies: ReadonlyArray<unknown>,
  dailySeed?: string
): PagedMediaState {
  const [items, setItems] = useState<MediaItem[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const reload = useCallback(async () => {
    const requestGeneration = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const response = await loader(1, dailySeed)
      if (generation.current !== requestGeneration) return
      // Apply deterministic shuffle if we have a daily seed and it's a fresh load
      let shuffledItems = response.items
      if (dailySeed && response.pages >= 1) {
        shuffledItems = deterministicShuffle(response.items, dailySeed)
      }
      setItems(shuffledItems)
      setPage(response.page)
      setPages(response.pages)
    } catch (reason) {
      if (generation.current !== requestGeneration) return
      setItems([])
      setPage(1)
      setPages(1)
      setError(reason instanceof Error ? reason.message : 'Unable to load live public data.')
    } finally {
      if (generation.current === requestGeneration) setLoading(false)
    }
  // loader identity is deliberately controlled by the screen's dependency list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, dailySeed, loading])

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || page >= pages) return
    const requestGeneration = generation.current
    const nextPage = page + 1
    setLoadingMore(true)
    try {
      const response = await loader(nextPage, dailySeed)
      if (generation.current !== requestGeneration) return
      setItems((current) => {
        const known = new Set(current.map((item) => item.id))
        const incoming = response.items.filter((item) => !known.has(item.id))
        // Apply deterministic shuffle to new incoming items
        const shuffledIncoming = deterministicShuffle(incoming, dailySeed)
        return [...current, ...shuffledIncoming]
      })
      setPage(response.page)
      setPages(response.pages)
    } catch (reason) {
      if (generation.current === requestGeneration) setError(reason instanceof Error ? reason.message : 'Unable to load more public data.')
    } finally {
      if (generation.current === requestGeneration) setLoadingMore(false)
    }
  }, [loader, loading, loadingMore, page, pages, dailySeed])

  const mergeFresh = useCallback(async () => {
    if (loading || loadingMore) return
    const requestGeneration = generation.current
    try {
      const response = await loader(1, dailySeed)
      if (generation.current !== requestGeneration) return
      // Only append NEW items at the BOTTOM - don't change existing order
      setItems((current) => {
        const known = new Set(current.map((item) => item.id))
        const incoming = response.items.filter((item) => !known.has(item.id))
        const shuffledIncoming = deterministicShuffle(incoming, dailySeed)
        return incoming.length ? [...current, ...shuffledIncoming] : current
      })
    } catch {
      /* keep the visible feed if a background refresh fails */
    }
  }, [loader, loading, loadingMore, dailySeed])

  useEffect(() => { void reload() }, [reload])

  return { items, loading, loadingMore, error, canLoadMore: page < pages, reload, loadMore, mergeFresh }
}