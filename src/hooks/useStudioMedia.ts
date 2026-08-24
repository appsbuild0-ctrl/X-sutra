import { useCallback, useEffect, useState } from 'react'
import type { MediaItem } from '../types'
import { studioApi } from '../lib/studioMedia'

interface StudioMediaState {
  items: MediaItem[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

/** Loads admin-uploaded media (stored in private Telegram storage) for display. */
export function useStudioMedia(): StudioMediaState {
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await studioApi.listMedia()
      setItems(list)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load studio media.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { items, loading, error, reload }
}
