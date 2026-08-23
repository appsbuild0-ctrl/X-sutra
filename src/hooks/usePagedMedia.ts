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
}

/** Shared real-data pagination with stale-request protection. */
export function usePagedMedia(
  loader: (page: number) => Promise<PageResult<MediaItem>>,
  dependencies: ReadonlyArray<unknown>
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
      const response = await loader(1)
      if (generation.current !== requestGeneration) return
      setItems(response.items)
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
  }, dependencies)

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || page >= pages) return
    const requestGeneration = generation.current
    const nextPage = page + 1
    setLoadingMore(true)
    try {
      const response = await loader(nextPage)
      if (generation.current !== requestGeneration) return
      setItems((current) => {
        const known = new Set(current.map((item) => item.id))
        return [...current, ...response.items.filter((item) => !known.has(item.id))]
      })
      setPage(response.page)
      setPages(response.pages)
    } catch (reason) {
      if (generation.current === requestGeneration) setError(reason instanceof Error ? reason.message : 'Unable to load more public data.')
    } finally {
      if (generation.current === requestGeneration) setLoadingMore(false)
    }
  }, [loader, loading, loadingMore, page, pages])

  useEffect(() => { void reload() }, [reload])

  return { items, loading, loadingMore, error, canLoadMore: page < pages, reload, loadMore }
}
