import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CreatorAvatar } from '../components/CreatorAvatar'
import { LiveError } from '../components/LiveState'
import { ScreenHeader } from '../components/ScreenHeader'
import { ArrowLeftIcon, BookmarkIcon, RefreshIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { hotpicApi, type HotpicProfile } from '../lib/hotpic'

export function PremiumModelScreen(): React.JSX.Element {
  const { username: encoded = '' } = useParams()
  const username = decodeURIComponent(encoded)
  const navigate = useNavigate()
  const { isFollowing, toggleFollow } = useApp()
  const [profile, setProfile] = useState<HotpicProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setError(null)
    try {
      setProfile(await hotpicApi.profile(username))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Profile unavailable')
    }
  }

  useEffect(() => { void load() }, [username])

  const following = isFollowing(username)
  const followTarget = {
    username,
    displayName: profile?.displayName || username,
    avatar: profile?.avatar,
    profileUrl: profile?.profileUrl,
    followers: 0,
    gifs: profile?.albums ?? 0,
    views: 0,
    verified: false
  }

  return (
    <section className="screen screen--ott">
      <ScreenHeader
        title={profile?.displayName || username}
        eyebrow="Hotpic account"
        actions={
          <>
            <button className="round-button" type="button" onClick={() => navigate('/premium')} aria-label="Back"><ArrowLeftIcon size={19} /></button>
            <button className="round-button" type="button" onClick={() => void load()} aria-label="Refresh"><RefreshIcon size={19} /></button>
          </>
        }
      />
      <div className="creator-profile-card">
        <CreatorAvatar src={profile?.avatar} label={profile?.displayName || username} className="creator-profile-card__avatar" />
        <div className="creator-profile-card__body">
          <p className="eyebrow">@{username}</p>
          <h2>{profile?.displayName || username}</h2>
          <div className="creator-profile-card__stats">
            <span><strong>{profile?.albums ?? 0}</strong> albums</span>
            {profile?.joined && <span>{profile.joined}</span>}
          </div>
        </div>
        <button className={`follow-button${following ? ' is-following' : ''}`} type="button" onClick={() => toggleFollow(followTarget)}>
          <BookmarkIcon size={17} filled={following} /> {following ? 'Following' : 'Follow'}
        </button>
      </div>
      {error && <LiveError message={error} onRetry={() => void load()} />}
      <div className="ott-row-head"><h3>Albums</h3></div>
      {profile?.items?.length ? (
        <div className="premium-album-grid">
          {profile.items.map((album) => (
            <button key={album.id} className="premium-album" type="button" onClick={() => navigate(`/premium/hotpic/${album.id}`)}>
              <span className="premium-album__cover" style={album.cover ? { backgroundImage: `url(${album.cover})` } : undefined} />
              <strong>{album.title}</strong>
              <small>@{username}</small>
            </button>
          ))}
        </div>
      ) : !error && <p className="form-help">No public albums on this account.</p>}
    </section>
  )
}
