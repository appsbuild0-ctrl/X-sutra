import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LiveError, ScreenNotice } from '../components/LiveState'
import { MediaGrid } from '../components/MediaGrid'
import { PullToRefresh } from '../components/PullToRefresh'
import { ScreenHeader } from '../components/ScreenHeader'
import { SparkIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { roleLabel } from '../lib/roles'
import { useOnlineMembers } from '../hooks/useOnlineMembers'
import { usePagedMedia } from '../hooks/usePagedMedia'
import { getDailySeed } from '../hooks/usePagedMedia'
import { defaultHub, loadHub, markNotificationsRead, openHubLink, relativeTime, unreadCount, type AdminHub } from '../lib/adminHub'
import { isRedgifsVideo, publicMediaApi } from '../lib/redgifs'
import { sortForUser, hasViewHistory, getTopCreators, getTopTags } from '../lib/viewHistory'
import type { FeedOrder, MediaItem, PageResult } from '../types'

type HomeFeed = 'latest' | 'trending' | 'likes' | 'views' | 'longest' | 'foryou'

const HOME_FEEDS: Array<{ id: HomeFeed; label: string; eyebrow: string; title: string }> = [
  { id: 'foryou', label: 'For You', eyebrow: 'Personalized', title: 'Your feed' },
  { id: 'latest', label: 'Latest', eyebrow: 'Newest uploads', title: 'Latest clips' },
  { id: 'trending', label: 'Trending', eyebrow: 'Public feed', title: 'Trending now' },
  { id: 'likes', label: 'Most liked', eyebrow: 'Ranked by likes', title: 'Most liked' },
  { id: 'views', label: 'Most views', eyebrow: 'Ranked by views', title: 'Most viewed' },
  { id: 'longest', label: 'Longest', eyebrow: 'Ranked by duration', title: 'Longest clips' }
]

function rankRealItems(items: MediaItem[], mode: HomeFeed): MediaItem[] {
  const ranked = [...items]
  if (mode === 'likes') return ranked.sort((a, b) => b.likes - a.likes)
  if (mode === 'views') return ranked.sort((a, b) => b.views - a.views)
  if (mode === 'longest') return ranked.sort((a, b) => b.duration - a.duration)
  return ranked
}

function normalizePage(result: PageResult<MediaItem>, logicalPage: number, firstApiPage: number, mode: HomeFeed): PageResult<MediaItem> {
  const remainingPages = result.pages > 0 ? result.pages - firstApiPage + 1 : 1
  return { ...result, items: rankRealItems(result.items, mode), page: logicalPage, pages: Math.max(logicalPage, remainingPages) }
}

export function HomeScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { preferences, account } = useApp()
  const [mode, setMode] = useState<HomeFeed>('foryou')
  const [firstApiPage, setFirstApiPage] = useState(1)
  // Daily seed for content rotation - different videos each day
  const dailySeed = getDailySeed()
  const [hub, setHub] = useState<AdminHub>(defaultHub)
  const [notesOpen, setNotesOpen] = useState(false)
  const [creatorFeeds, setCreatorFeeds] = useState<Map<string, MediaItem[]>>(new Map())
  const onlineMembers = useOnlineMembers()
  const selected = HOME_FEEDS.find((feed) => feed.id === mode) ?? HOME_FEEDS[0]
  const card = hub.homeCard
  const notes = hub.notifications.filter((item) => item.active)
  const unread = unreadCount(hub)
  const hasPersonalization = hasViewHistory()
  const topCreators = getTopCreators(5)
  const topTags = getTopTags(8)

  useEffect(() => { void loadHub().then(setHub) }, [])

  // Load feeds from top creators for personalization
  useEffect(() => {
    if (!hasPersonalization) return
    const creators = getTopCreators(6)
    let cancelled = false
    
    async function loadCreatorFeeds() {
      const feeds = new Map<string, MediaItem[]>()
      for (const creator of creators) {
        if (cancelled) break
        try {
          const result = await publicMediaApi.creator(creator, 1, 'latest')
          feeds.set(creator, result.items.slice(0, 10))
        } catch {
          // Skip failed creator feeds
        }
      }
      if (!cancelled) setCreatorFeeds(feeds)
    }
    
    void loadCreatorFeeds()
    return () => { cancelled = true }
  }, [hasPersonalization])

  const loadFeed = useCallback(async (logicalPage: number) => {
    const apiPage = firstApiPage + logicalPage - 1
    let result: PageResult<MediaItem>
    
    if (mode === 'foryou') {
      // For You: Mix trending + latest for variety
      const [trending, latest] = await Promise.all([
        publicMediaApi.trending(apiPage),
        publicMediaApi.latest(apiPage, 'latest')
      ])
      
      if (!hasViewHistory()) {
        // No history yet - mix trending and latest
        const mixed = [...trending.items, ...latest.items]
        // Shuffle for variety using daily seed for consistent daily rotation
        for (let i = mixed.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [mixed[i], mixed[j]] = [mixed[j], mixed[i]]
        }
        return { ...trending, items: mixed, page: logicalPage, pages: Math.max(trending.pages, latest.pages) }
      }
      
      // Sort by user preferences
      const allItems = [...trending.items, ...latest.items]
      const personalized = sortForUser(allItems)
      // Also apply daily rotation to personalized feed
      const shuffledPersonalized = deterministicShuffle(personalized, dailySeed)
      return { ...trending, items: shuffledPersonalized, page: logicalPage, pages: Math.max(trending.pages, latest.pages) }
    }
    
    if (mode === 'trending') result = await publicMediaApi.trending(apiPage)
    else {
      const order: FeedOrder = mode === 'likes' ? 'top' : mode === 'views' ? 'score' : 'latest'
      result = await publicMediaApi.latest(apiPage, order)
    }
    return normalizePage(result, logicalPage, firstApiPage, mode)
  }, [firstApiPage, mode])
  const feed = usePagedMedia(loadFeed, [mode, firstApiPage], dailySeed)

  // Stable feed - no auto-refresh that changes order. User scrolls = load more at bottom only.
  const [scrollProgress, setScrollProgress] = useState(0)
  
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0
      setScrollProgress(Math.min(progress, 100))
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Build personalized feed ONCE when feed loads - stable, no re-sorting
  const personalizedItems = useMemo(() => {
    if (mode !== 'foryou' || !hasPersonalization) return feed.items
    
    const allItems: MediaItem[] = [...feed.items]
    
    // Add items from top creators user watches
    creatorFeeds.forEach((items) => {
      items.forEach(item => {
        if (!allItems.some(i => i.id === item.id)) {
          allItems.push(item)
        }
      })
    })
    
    // Sort by user's viewing preferences - ONLY ONCE when feed first loads
    return sortForUser(allItems).slice(0, 100)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.items.length > 0 ? feed.items[0].id : 'empty', mode, hasPersonalization, creatorFeeds.size])

  const visibleItems = useMemo(() => {
    const blocked = new Set(preferences.blockedTags.map((tag) => tag.toLowerCase()))
    const hidden = new Set(hub.hiddenVideos)
    const sourceItems = mode === 'foryou' && hasPersonalization ? personalizedItems : feed.items
    return sourceItems.filter((item) => isRedgifsVideo(item) && !hidden.has(item.id) && !item.tags.some((tag) => blocked.has(tag.toLowerCase())))
  }, [feed.items, personalizedItems, mode, hasPersonalization, preferences.blockedTags, hub.hiddenVideos])

  const refreshRealFeed = useCallback(async () => {
    setFirstApiPage((current) => current >= 7 ? 1 : current + 1)
    void loadHub().then(setHub)
  }, [])

  const openNotes = () => {
    setNotesOpen((open) => !open)
    markNotificationsRead(hub)
  }

  return (
    <PullToRefresh onRefresh={refreshRealFeed}>
      <div className="feed-progress-bar" style={{ width: `${scrollProgress}%` }} />
      <section className="screen screen--home">
        <ScreenHeader showMark title="RedGrab" actions={
          <div className="home-header-actions">
            <button className="notify-bell" type="button" onClick={openNotes} aria-label="Notifications">
              🔔{unread > 0 && <i>{unread}</i>}
            </button>
            {account ? (
              <div className="home-profile-area" onClick={() => navigate('/you')} role="button" aria-label="Go to your profile">
                <InstagramAvatar src={account?.profileImageUrl || undefined} label={account?.username || account?.name || 'U'} size={40} />
                <span className="home-profile-text">{account.username ? '@' + account.username : ''}</span>
              </div>
            ) : (
              <button className="home-cta home-cta--login" type="button" onClick={() => navigate('/login')}>Login</button>
            )}
          </div>
        } />

        {notesOpen && (
          <div className="notify-panel">
            <p className="eyebrow">Notifications</p>
            {!notes.length && <p className="form-help">No notifications yet.</p>}
            {notes.map((item) => (
              <button key={item.id} className="notify-item" type="button" onClick={() => item.link ? openHubLink(item.link, navigate) : undefined}>
                <strong>{item.title}</strong>
                <small>{item.message}</small>
                <em>{relativeTime(item.createdAt)}</em>
              </button>
            ))}
          </div>
        )}

        <style>{`
          .home-profile-area { display: flex; align-items: center; gap: 8px; }
          .home-profile-area:hover { background: rgba(255,255,255,0.1); border-radius: 20px; padding: 6px 12px; }
          .home-profile-text { color: var(--p-text, #333); font-size: 13px; }
          .home-cta--login { min-width: 120px; }
        `}</style>

        {card.enabled && (
          <div className="home-intro" style={card.image ? { backgroundImage: `${card.overlay ? 'linear-gradient(180deg, rgba(8,6,6,.25), rgba(8,6,6,.78)), ' : ''}url(${card.image})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
            <div>
              <p className="home-intro__kicker"><SparkIcon size={16} /> {card.label}</p>
              <h2>{card.title}</h2>
              <p>{card.description}</p>
              <div className="home-header-actions" style={{ marginTop: 14 }}>
                {card.buttonText && <button className="primary-button" type="button" onClick={() => openHubLink(card.buttonUrl, navigate)}>{card.buttonText}</button>}
                {card.secondaryText && <button className="secondary-button" type="button" onClick={() => openHubLink(card.secondaryUrl, navigate)}>{card.secondaryText}</button>}
              </div>
            </div>
            <div className="home-intro__pills">
              <span className="online-pill"><i />{card.online || `${onlineMembers.toLocaleString('en-IN')} online`}</span>
              <span className="live-pill"><i /> Live V2</span>
            </div>
          </div>
        )}

        <div className="home-feed-tabs" role="tablist" aria-label="Home feed selection">
          {HOME_FEEDS.map((feedOption) => <button key={feedOption.id} className={mode === feedOption.id ? 'is-active' : ''} type="button" role="tab" aria-selected={mode === feedOption.id} onClick={() => { setMode(feedOption.id); setFirstApiPage(1) }}>{feedOption.label}</button>)}
        </div>

        {preferences.blockedTags.length > 0 && <ScreenNotice>{preferences.blockedTags.length} blocked tag{preferences.blockedTags.length === 1 ? '' : 's'} are hidden from this live feed.</ScreenNotice>}
        <div className="section-heading"><div><p className="eyebrow">{selected.eyebrow}</p><h3>{selected.title}</h3></div>{!feed.loading && <span>{visibleItems.length} loaded</span>}</div>

        {feed.error ? <LiveError message={feed.error} onRetry={feed.reload} /> : <MediaGrid items={visibleItems} loading={feed.loading} canLoadMore={feed.canLoadMore} loadingMore={feed.loadingMore} onLoadMore={() => void feed.loadMore()} empty={<div className="empty-state"><strong>No public clips matched.</strong><span>Change the feed or review blocked tags in Settings.</span></div>} />}
      </section>
    </PullToRefresh>
  )
}
