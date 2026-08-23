import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { compactNumber, durationLabel } from '../lib/format'
import {
  BookmarkIcon,
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  ExternalIcon,
  HeartIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  ShareIcon,
  UserIcon,
  VolumeIcon
} from './icons'

/** Source-style immersive player for the real queue opened from a media grid. */
export function VideoPlayerSheet(): React.JSX.Element | null {
  const {
    activeMedia,
    playerQueue,
    playerIndex,
    closePlayer,
    stepPlayer,
    isLiked,
    toggleLike,
    isSaved,
    toggleSaved,
    isFollowing,
    toggleFollow,
    requestDownload,
    updatePreferences,
    collections,
    addToCollection,
    notify
  } = useApp()
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const touchStart = useRef<number | null>(null)
  const lastTap = useRef(0)
  const [playing, setPlaying] = useState(true)
  // Mobile browsers allow dependable autoplay for muted media. The user can
  // turn sound on from the source-style action rail after playback begins.
  const [muted, setMuted] = useState(true)
  const [progress, setProgress] = useState(0)
  const [videoError, setVideoError] = useState(false)
  const [collectionId, setCollectionId] = useState('')
  const [heartBurst, setHeartBurst] = useState(false)

  useEffect(() => {
    if (!activeMedia) return
    setProgress(0)
    setVideoError(false)
    setCollectionId('')
    setPlaying(true)
    setMuted(true)
    const timeout = window.setTimeout(() => {
      const video = videoRef.current
      if (!video) return
      video.muted = true
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }, 40)
    return () => window.clearTimeout(timeout)
  }, [activeMedia?.id])

  useEffect(() => {
    if (!activeMedia) return
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePlayer()
      if (event.key === 'ArrowDown') stepPlayer(1)
      if (event.key === 'ArrowUp') stepPlayer(-1)
      if (event.key === ' ') {
        event.preventDefault()
        togglePlayback()
      }
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  // `togglePlayback` is intentionally stable enough for this document listener.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMedia?.id, closePlayer, stepPlayer])

  if (!activeMedia) return null
  const media = activeMedia

  const source = media.videoUrl ?? media.videoUrlSd
  const embedUrl = `https://www.redgifs.com/ifr/${encodeURIComponent(media.id)}?autoplay=1`
  const liked = isLiked(activeMedia.id)
  const saved = isSaved(activeMedia.id)
  const following = isFollowing(activeMedia.creator)
  const canNext = playerIndex < playerQueue.length - 1
  const canPrevious = playerIndex > 0

  function togglePlayback(): void {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else {
      video.pause()
      setPlaying(false)
    }
  }

  function toggleMute(): void {
    const next = !muted
    setMuted(next)
    updatePreferences({ muted: next })
    if (videoRef.current) videoRef.current.muted = next
  }

  function burstLike(): void {
    setHeartBurst(true)
    window.setTimeout(() => setHeartBurst(false), 580)
    if (!liked) toggleLike(media)
  }

  function onVideoTap(): void {
    const now = Date.now()
    if (now - lastTap.current < 280) {
      lastTap.current = 0
      burstLike()
      return
    }
    lastTap.current = now
    window.setTimeout(() => {
      if (lastTap.current === now) {
        lastTap.current = 0
        togglePlayback()
      }
    }, 280)
  }

  async function share(): Promise<void> {
    const payload = { title: media.title, text: `@${media.creator} on X-sutra`, url: media.sourceUrl }
    try {
      if (navigator.share) {
        await navigator.share(payload)
        notify('Share sheet opened', 'success')
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(media.sourceUrl)
        notify('Source link copied', 'success')
      } else {
        notify('Sharing is not supported by this browser', 'error')
      }
    } catch {
      // User cancelling the native share sheet is not an error worth surfacing.
    }
  }

  const openRoute = (path: string) => {
    closePlayer()
    navigate(path)
  }

  return (
    <div
      className="immersive-player"
      role="dialog"
      aria-modal="true"
      aria-label={`Player for ${activeMedia.title}`}
      onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientY ?? null }}
      onTouchEnd={(event) => {
        if (touchStart.current === null) return
        const end = event.changedTouches[0]?.clientY ?? touchStart.current
        const delta = end - touchStart.current
        touchStart.current = null
        if (delta < -86 && canNext) stepPlayer(1)
        if (delta > 86 && canPrevious) stepPlayer(-1)
      }}
    >
      <div className="immersive-player__media" onClick={onVideoTap}>
        {source && !videoError ? (
          <video
            ref={videoRef}
            key={media.id}
            src={source}
            poster={media.thumbnail}
            loop
            playsInline
            muted={muted}
            preload="auto"
            autoPlay
            onError={() => { setVideoError(true); setPlaying(false) }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => {
              const video = event.currentTarget
              if (video.duration) setProgress(video.currentTime / video.duration)
            }}
          />
        ) : <iframe className="immersive-player__embed" src={embedUrl} title="Public RedGifs video" allow="autoplay; fullscreen" allowFullScreen />}
      </div>
      <div className="immersive-player__scrim" />

      {heartBurst && <span className="immersive-player__heart" aria-hidden="true"><HeartIcon filled size={76} /></span>}
      {!playing && !videoError && <span className="immersive-player__paused" aria-hidden="true"><PlayIcon size={34} /></span>}
      {videoError && <div className="immersive-player__error">Using the public embed fallback. <a href={media.sourceUrl} target="_blank" rel="noreferrer">Open source</a></div>}

      <header className="immersive-player__top">
        <span>{playerIndex + 1} / {playerQueue.length || 1} · public video</span>
        <button type="button" onClick={closePlayer} aria-label="Close player"><CloseIcon size={21} /></button>
      </header>

      <aside className="immersive-player__rail" aria-label="Player actions">
        <RailAction label={liked ? 'Liked' : 'Like'} active={liked} onClick={() => toggleLike(activeMedia)}><HeartIcon filled={liked} size={22} /></RailAction>
        <RailAction label="Share" onClick={() => void share()}><ShareIcon size={22} /></RailAction>
        <RailAction label={muted ? 'Sound off' : 'Sound on'} onClick={toggleMute}>{muted ? <MuteIcon size={22} /> : <VolumeIcon size={22} />}</RailAction>
        <RailAction label={saved ? 'Saved' : 'Save'} active={saved} onClick={() => toggleSaved(activeMedia)}><BookmarkIcon filled={saved} size={22} /></RailAction>
        <RailAction label="Download" onClick={() => void requestDownload(activeMedia)}><DownloadIcon size={22} /></RailAction>
      </aside>

      <footer className="immersive-player__info">
        <div className="immersive-player__creator">
          <button className={`player-follow-button${following ? ' is-on' : ''}`} type="button" onClick={() => toggleFollow({ username: activeMedia.creator, displayName: activeMedia.creator, followers: 0, gifs: 0, views: 0, verified: false })} aria-label={following ? 'Unfollow creator' : 'Follow creator'}>
            {following ? <CheckIcon size={16} /> : <UserIcon size={16} />}
          </button>
          <div>
            <button className="immersive-player__handle" type="button" onClick={() => openRoute(`/creator/${encodeURIComponent(activeMedia.creator)}`)}>@{activeMedia.creator}</button>
            <p>{compactNumber(activeMedia.views)} views · {durationLabel(activeMedia.duration)}</p>
          </div>
        </div>
        <h2>{activeMedia.title}</h2>
        {activeMedia.tags.length > 0 && <div className="immersive-player__tags">{activeMedia.tags.slice(0, 7).map((tag) => <button type="button" key={tag} onClick={() => openRoute(`/tag/${encodeURIComponent(tag)}`)}>#{tag}</button>)}</div>}
        {collections.length > 0 && <div className="immersive-player__collection"><select value={collectionId} onChange={(event) => setCollectionId(event.target.value)} aria-label="Choose collection"><option value="">Add to collection…</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select><button type="button" disabled={!collectionId} onClick={() => { if (collectionId) addToCollection(collectionId, activeMedia); setCollectionId('') }}>Add</button></div>}
      </footer>
      <div className="immersive-player__progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      {canPrevious && <button className="immersive-player__step immersive-player__step--up" type="button" onClick={() => stepPlayer(-1)} aria-label="Previous video">‹</button>}
      {canNext && <button className="immersive-player__step immersive-player__step--down" type="button" onClick={() => stepPlayer(1)} aria-label="Next video">›</button>}
      {!source && <a className="immersive-player__source" href={activeMedia.sourceUrl} target="_blank" rel="noreferrer"><ExternalIcon size={17} /> Open source</a>}
    </div>
  )
}

function RailAction({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return <button className={`immersive-player__action${active ? ' is-active' : ''}`} type="button" onClick={onClick}><span>{children}</span><small>{label}</small></button>
}
