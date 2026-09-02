/**
 * View history tracking for personalized feed algorithm.
 * Tracks creators and niches the user watches most.
 */

const STORAGE_KEY = 'viewHistory'
const MAX_CREATORS = 50
const MAX_NICHES = 30

interface ViewEntry {
  creator: string
  niche?: string
  tags: string[]
  watchTime: number
  lastViewed: number
}

interface ViewHistory {
  creators: Map<string, { count: number; lastViewed: number; tags: Set<string> }>
  niches: Map<string, { count: number; lastViewed: number }>
  tags: Map<string, { count: number; lastViewed: number }>
}

/** Load history from localStorage */
function loadHistory(): ViewHistory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createEmptyHistory()
    const data = JSON.parse(raw)
    return {
      creators: new Map(Object.entries(data.creators || {}).map(([k, v]: [string, unknown]) => {
        const val = v as { count: number; lastViewed: number; tags: string[] }
        return [k, { ...val, tags: new Set(val.tags || []) }]
      })),
      niches: new Map(Object.entries(data.niches || {})),
      tags: new Map(Object.entries(data.tags || {}))
    }
  } catch {
    return createEmptyHistory()
  }
}

function createEmptyHistory(): ViewHistory {
  return {
    creators: new Map(),
    niches: new Map(),
    tags: new Map()
  }
}

/** Save history to localStorage */
function saveHistory(history: ViewHistory): void {
  try {
    const data = {
      creators: Object.fromEntries(
        Array.from(history.creators.entries()).map(([k, v]) => [k, { count: v.count, lastViewed: v.lastViewed, tags: Array.from(v.tags) }])
      ),
      niches: Object.fromEntries(history.niches),
      tags: Object.fromEntries(history.tags)
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Storage full or unavailable
  }
}

/** Record that user watched a media item */
export function recordView(item: { creator: string; niches?: string[]; tags?: string[] }, watchDurationMs: number = 0): void {
  if (!item.creator) return
  const history = loadHistory()
  const now = Date.now()

  // Update creator stats
  const creatorStats = history.creators.get(item.creator) || { count: 0, lastViewed: 0, tags: new Set<string>() }
  creatorStats.count += 1
  creatorStats.lastViewed = now
  if (item.tags) {
    item.tags.slice(0, 5).forEach(tag => creatorStats.tags.add(tag))
  }
  history.creators.set(item.creator, creatorStats)

  // Update niche stats
  if (item.niches?.length) {
    const niche = item.niches[0]
    const nicheStats = history.niches.get(niche) || { count: 0, lastViewed: 0 }
    nicheStats.count += 1
    nicheStats.lastViewed = now
    history.niches.set(niche, nicheStats)
  }

  // Update tag stats
  if (item.tags) {
    item.tags.slice(0, 8).forEach(tag => {
      const tagStats = history.tags.get(tag) || { count: 0, lastViewed: 0 }
      tagStats.count += 1
      tagStats.lastViewed = now
      history.tags.set(tag, tagStats)
    })
  }

  // Trim old entries
  trimOldEntries(history)
  saveHistory(history)
}

/** Trim history to prevent unbounded growth */
function trimOldEntries(history: ViewHistory): void {
  // Keep only top creators by count
  const sortedCreators = Array.from(history.creators.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, MAX_CREATORS)
  history.creators = new Map(sortedCreators)

  // Keep only top niches
  const sortedNiches = Array.from(history.niches.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, MAX_NICHES)
  history.niches = new Map(sortedNiches)
}

/** Get top creators user watches most */
export function getTopCreators(limit = 10): string[] {
  const history = loadHistory()
  return Array.from(history.creators.entries())
    .sort((a, b) => {
      // Prefer recent AND frequent
      const scoreA = a[1].count * Math.log(Date.now() - a[1].lastViewed + 1)
      const scoreB = b[1].count * Math.log(Date.now() - b[1].lastViewed + 1)
      return scoreB - scoreA
    })
    .slice(0, limit)
    .map(([creator]) => creator)
}

/** Get top niches user watches */
export function getTopNiches(limit = 5): string[] {
  const history = loadHistory()
  return Array.from(history.niches.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([niche]) => niche)
}

/** Get top tags user watches */
export function getTopTags(limit = 10): string[] {
  const history = loadHistory()
  return Array.from(history.tags.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([tag]) => tag)
}

/** Score a media item based on user's view history */
export function scoreForUser(item: { creator: string; niches?: string[]; tags?: string[] }): number {
  const history = loadHistory()
  let score = 0

  // Creator match: +10 per view, bonus for recent
  const creatorStats = history.creators.get(item.creator)
  if (creatorStats) {
    score += creatorStats.count * 10
    const recencyDays = (Date.now() - creatorStats.lastViewed) / (1000 * 60 * 60 * 24)
    score += Math.max(0, 20 - recencyDays * 2) // Recent bonus
  }

  // Niche match: +5 per view
  if (item.niches?.length) {
    const niche = item.niches[0]
    const nicheStats = history.niches.get(niche)
    if (nicheStats) {
      score += nicheStats.count * 5
    }
  }

  // Tag match: +2 per view per tag
  if (item.tags?.length) {
    item.tags.forEach(tag => {
      const tagStats = history.tags.get(tag)
      if (tagStats) {
        score += tagStats.count * 2
      }
    })
  }

  return score
}

/** Sort feed items by user's preferences */
export function sortForUser<T extends { creator: string; niches?: string[]; tags?: string[] }>(items: T[]): T[] {
  const history = loadHistory()
  if (history.creators.size === 0 && history.niches.size === 0 && history.tags.size === 0) {
    return items // No history yet, return as-is
  }

  return [...items].sort((a, b) => scoreForUser(b) - scoreForUser(a))
}

/** Check if user has any viewing history */
export function hasViewHistory(): boolean {
  const history = loadHistory()
  return history.creators.size > 0 || history.niches.size > 0 || history.tags.size > 0
}

/** Clear all view history */
export function clearViewHistory(): void {
  localStorage.removeItem(STORAGE_KEY)
}
