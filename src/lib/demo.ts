import type { Creator, MediaItem, Niche } from '../types'

const gradients = [
  'linear-gradient(145deg, #59211d 0%, #b4452e 49%, #f1a25a 100%)',
  'linear-gradient(145deg, #2a1830 0%, #73404d 53%, #e0704c 100%)',
  'linear-gradient(145deg, #201e2d 0%, #414569 45%, #ca674a 100%)',
  'linear-gradient(145deg, #48261d 0%, #7b3330 50%, #f5b66a 100%)',
  'linear-gradient(145deg, #24232c 0%, #5b3b47 47%, #d85c41 100%)',
  'linear-gradient(145deg, #36201c 0%, #8f4735 52%, #f19a55 100%)'
]

const titles = [
  'Afterglow loop',
  'Velvet motion',
  'Late night frame',
  'Heatwave archive',
  'Quiet signal',
  'Ember study',
  'Slow orbit',
  'City glow',
  'Soft focus',
  'Sienna hour',
  'Neon reverie',
  'Warm static'
]

const creators = ['mira', 'noor', 'ava', 'luna', 'sora', 'ivy', 'rhea', 'dani', 'sky', 'jade', 'rio', 'elle']

/** Graceful local content when the remote public feed is temporarily unavailable. */
export const demoMedia: MediaItem[] = titles.map((title, index) => ({
  id: `xs-demo-${index + 1}`,
  title,
  creator: creators[index],
  duration: 8 + index * 3,
  likes: 1200 + index * 879,
  views: 7400 + index * 2150,
  tags: ['featured', index % 2 ? 'fresh' : 'trending'],
  gradient: gradients[index % gradients.length],
  isDemo: true,
  width: index % 3 === 0 ? 1080 : 720,
  height: index % 3 === 0 ? 1440 : 1280
}))

export const demoCreators: Creator[] = [
  ['mira', 'Mira Vale', 201_000],
  ['noor', 'Noor', 184_000],
  ['ava', 'Ava M.', 160_000],
  ['luna', 'Luna Ardent', 139_000],
  ['sora', 'Sora', 121_000],
  ['ivy', 'Ivy Reed', 98_000]
].map(([username, displayName, followers], index) => ({
  username: String(username),
  displayName: String(displayName),
  followers: Number(followers),
  verified: index < 3,
  avatar: undefined
}))

export const demoNiches: Niche[] = [
  'Trending',
  'New creators',
  'Soft light',
  'Editorial',
  'Night mode',
  'Popular now',
  'Fresh clips',
  'Looped'
].map((name) => ({ id: name.toLowerCase().replace(/\s+/g, '-'), name }))

export function demoSearch(query: string): MediaItem[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return demoMedia
  const matches = demoMedia.filter((item) =>
    `${item.title} ${item.creator} ${item.tags.join(' ')}`.toLowerCase().includes(normalized)
  )
  return matches.length ? matches : demoMedia.map((item, index) => ({
    ...item,
    id: `${item.id}-${normalized}`,
    title: `${item.title} · ${query.trim()}`
  }))
}
