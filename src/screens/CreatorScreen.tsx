import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CreatorAvatar } from '../components/CreatorAvatar'
import { LiveError, ScreenNotice } from '../components/LiveState'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { ArrowLeftIcon, BookmarkIcon, RefreshIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { usePagedMedia } from '../hooks/usePagedMedia'
import { compactNumber } from '../lib/format'
import { publicMediaApi } from '../lib/redgifs'
import type { CreatorProfile, FeedOrder } from '../types'

export function CreatorScreen(): React.JSX.Element {
  const { username: encodedUsername = '' } = useParams()
  const username = decodeURIComponent(encodedUsername)
  const navigate = useNavigate()
  const { isFollowing, toggleFollow } = useApp()
  const [profile, setProfile] = useState<CreatorProfile | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [profileError, setProfileError] = useState<string | null>(null)
  const [order, setOrder] = useState<FeedOrder>('latest')

  const feed = usePagedMedia(useCallback((page: number) => publicMediaApi.creator(username, page, order), [username, order]), [username, order])

  const loadProfile = useCallback(async () => {
    setProfileError(null)
    try {
      const [profileResult, tagsResult] = await Promise.all([publicMediaApi.creatorProfile(username), publicMediaApi.creatorTags(username)])
      setProfile(profileResult)
      setTags(tagsResult)
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : 'Creator profile is unavailable.')
    }
  }, [username])

  useEffect(() => { void loadProfile() }, [loadProfile])

  const followTarget = profile ?? {
    username,
    displayName: username,
    followers: 0,
    gifs: 0,
    views: 0,
    verified: false,
    following: 0,
    likes: 0
  }
  const following = isFollowing(username)

  return (
    <section className="screen">
      <ScreenHeader
        title="Creator"
        eyebrow="Public profile"
        actions={<><button className="round-button" type="button" onClick={() => void loadProfile()} aria-label="Refresh creator"><RefreshIcon size={19} /></button><button className="round-button" type="button" onClick={() => navigate(-1)} aria-label="Go back"><ArrowLeftIcon size={19} /></button></>}
      />

      <div className="creator-profile-card">
        <CreatorAvatar src={profile?.avatar} label={profile?.displayName || username} className="creator-profile-card__avatar" />
        <div className="creator-profile-card__body">
          <p className="eyebrow">@{username}</p>
          <h2>{profile?.displayName || username}</h2>
          <div className="creator-profile-card__stats">
            <span><strong>{compactNumber(profile?.followers)}</strong> followers</span>
            <span><strong>{compactNumber(profile?.gifs)}</strong> clips</span>
            <span><strong>{compactNumber(profile?.views)}</strong> views</span>
          </div>
        </div>
        <button className={`follow-button${following ? ' is-following' : ''}`} type="button" onClick={() => toggleFollow(followTarget)}><BookmarkIcon size={17} filled={following} /> {following ? 'Following' : 'Follow'}</button>
      </div>

      {profileError && <ScreenNotice>Profile details could not load, but public creator clips may still be available.</ScreenNotice>}

      {tags.length > 0 && (
        <>
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Creator tags</p><h3>Browse topics</h3></div></div>
          <div className="tag-row tag-row--page">
            {tags.slice(0, 18).map((tag) => <button className="tag tag--button" type="button" key={tag} onClick={() => navigate(`/tag/${encodeURIComponent(tag)}`)}>#{tag}</button>)}
          </div>
        </>
      )}

      <div className="feed-toolbar creator-feed-toolbar">
        <div className="section-heading section-heading--inline"><div><p className="eyebrow">Creator feed</p><h3>Public clips</h3></div></div>
        <label className="sort-control"><span className="sr-only">Sort creator clips</span><select value={order} onChange={(event) => setOrder(event.target.value as FeedOrder)}><option value="latest">Latest</option><option value="score">Score</option><option value="top">Top</option></select></label>
      </div>

      {feed.error ? <LiveError message={feed.error} onRetry={feed.reload} title="Creator clips could not load." /> : (
        <MediaGrid items={feed.items} loading={feed.loading} canLoadMore={feed.canLoadMore} loadingMore={feed.loadingMore} onLoadMore={() => void feed.loadMore()} empty={<div className="empty-state"><strong>No public clips are available for this creator.</strong></div>} />
      )}
    </section>
  )
}
