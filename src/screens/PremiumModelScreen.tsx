import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CreatorAvatar } from '../components/CreatorAvatar'
import { LiveError } from '../components/LiveState'
import { ScreenHeader } from '../components/ScreenHeader'
import { ArrowLeftIcon, BookmarkIcon, PlayIcon, RefreshIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { hotpicApi, type HotpicAlbumCard, type HotpicProfile } from '../lib/hotpic'

export function PremiumModelScreen(): React.JSX.Element {
  const { username: encoded = '' } = useParams()
  const username = decodeURIComponent(encoded)
  const navigate = useNavigate()
  const { isFollowing, toggleFollow, openPlayer } = useApp()
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

  const albums = (profile?.items ?? []).filter((card) => (card.kind || 'album') === 'album')
  const pics = (profile?.items ?? []).filter((card) => card.kind === 'pic')
  const videos = (profile?.items ?? []).filter((card) => card.kind === 'video')

  const openCard = (card: HotpicAlbumCard) => {
    if ((card.kind || 'album') === 'album') {
      navigate(`/premium/hotpic/${card.id}`)
      return
    }
    const item = hotpicApi.cardToMedia(card)
    const queue = (card.kind === 'video' ? videos : pics).map(hotpicApi.cardToMedia)
    openPlayer(item, queue.length ? queue : [item])
  }

  const Grid = ({ cards }: { cards: HotpicAlbumCard[] }) => cards.length ? (
    <div className="hp-grid">
      {cards.map((card) => (
        <button key={`${card.kind}-${card.id}`} className="hp-card" type="button" onClick={() => openCard(card)}>
          <span className="hp-card__media" style={card.cover ? { backgroundImage: `url(${card.cover})` } : undefined}>
            {(card.kind === 'video' || card.hasVideo) && <i className="hp-card__play"><PlayIcon size={18} /></i>}
          </span>
          <strong>{card.title}</strong>
        </button>
      ))}
    </div>
  ) : <p className="form-help">Nothing public here yet.</p>

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
            <span><strong>{albums.length}</strong> albums</span>
            <span><strong>{pics.length}</strong> pics</span>
            <span><strong>{videos.length}</strong> videos</span>
          </div>
        </div>
        <button className={`follow-button${following ? ' is-following' : ''}`} type="button" onClick={() => toggleFollow(followTarget)}>
          <BookmarkIcon size={17} filled={following} /> {following ? 'Following' : 'Follow'}
        </button>
      </div>
      {error && <LiveError message={error} onRetry={() => void load()} />}
      <div className="ott-row-head"><h3>Albums</h3></div>
      <Grid cards={albums} />
      <div className="ott-row-head"><h3>Pics</h3></div>
      <Grid cards={pics} />
      <div className="ott-row-head"><h3>Videos</h3></div>
      <Grid cards={videos} />
    </section>
  )
}
