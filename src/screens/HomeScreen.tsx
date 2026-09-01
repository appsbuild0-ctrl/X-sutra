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
import { defaultHub, loadHub, markNotificationsRead, openHubLink, relativeTime, unreadCount, type AdminHub } from '../lib/adminHub'
import { isRedgifsVideo, publicMediaApi } from '../lib/redgifs'
import type { FeedOrder, MediaItem, PageResult } from '../types'

type HomeFeed = 'latest' | 'trending' | 'likes' | 'views' | 'longest'

const HOME_FEEDS: Array<{ id: HomeFeed; label: string; eyebrow: string; title: string }> = [
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
  const [mode, setMode] = useState<HomeFeed>('trending')
  const [firstApiPage, setFirstApiPage] = useState(1)
  const [hub, setHub] = useState<AdminHub>(defaultHub)
  const [notesOpen, setNotesOpen] = useState(false)
  const onlineMembers = useOnlineMembers()
  const selected = HOME_FEEDS.find((feed) => feed.id === mode) ?? HOME_FEEDS[0]
  const card = hub.homeCard
  const notes = hub.notifications.filter((item) => item.active)
  const unread = unreadCount(hub)

  useEffect(() => { void loadHub().then(setHub) }, [])

  const loadFeed = useCallback(async (logicalPage: number) => {
    const apiPage = firstApiPage + logicalPage - 1
    let result: PageResult<MediaItem>
    if (mode === 'trending') result = await publicMediaApi.trending(apiPage)
    else {
      const order: FeedOrder = mode === 'likes' ? 'top' : mode === 'views' ? 'score' : 'latest'
      result = await publicMediaApi.latest(apiPage, order)
    }
    return normalizePage(result, logicalPage, firstApiPage, mode)
  }, [firstApiPage, mode])
  const feed = usePagedMedia(loadFeed, [mode, firstApiPage])

  useEffect(() => {
    const timer = window.setInterval(() => { void feed.mergeFresh() }, 60_000)
    return () => window.clearInterval(timer)
  }, [feed.mergeFresh])

  const visibleItems = useMemo(() => {
    const blocked = new Set(preferences.blockedTags.map((tag) => tag.toLowerCase()))
    const hidden = new Set(hub.hiddenVideos)
    return feed.items.filter((item) => isRedgifsVideo(item) && !hidden.has(item.id) && !item.tags.some((tag) => blocked.has(tag.toLowerCase())))
  }, [feed.items, preferences.blockedTags, hub.hiddenVideos])

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
      <section className="screen screen--home">
        <ScreenHeader showMark title="RedGrab" actions={
          <div className="home-header-actions">
            <button className="notify-bell" type="button" onClick={openNotes} aria-label="Notifications">
              🔔{unread > 0 && <i>{unread}</i>}
            </button>
            <button className="home-cta home-cta--login" type="button" onClick={() => navigate(account ? (account.role === 'admin' ? '/admin' : '/you') : '/login')}>{account ? roleLabel(account.role) : 'Login'}</button>
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
