import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { compactNumber, durationLabel } from '../lib/format'
import { playbackCandidates } from '../lib/media'
import {
  BookmarkIcon,
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  HeartIcon,
  MuteIcon,
  PlayIcon,
  PlusIcon,
  ShareIcon,
  UserIcon,
  VolumeIcon
} from './icons'
import { DownloadGate } from './DownloadGate'
import type { MediaItem } from '../types'

const SWIPE_COMMIT = 0.18
const WHEEL_STEP_PX = 60
const STEP_LOCK_MS = 320
const DOUBLE_TAP_MS = 280

/**
 * Full-screen swipe/wheel player, ported 1:1 from the reference app's
 * Player.tsx: drag or scroll-wheel up/down to move between clips, single-tap
 * pauses (instant), double-tap likes, the rail carries like/sound/save/
 * download, and the previous/current/next slides stay mounted and preloaded
 * so stepping is instant.
 */
export function VideoPlayerSheet(): React.JSX.Element | null {
  const {
    activeMedia,
    playerQueue,
    playerIndex,
    closePlayer,
    stepPlayer,
    refreshActiveMedia,
    isLiked,
    toggleLike,
    isSaved,
    toggleSaved,
    isFollowing,
    toggleFollow,
    requestDownload,
    preferences,
    updatePreferences,
    notify
  } = useApp()
  const navigate = useNavigate()

  const items = playerQueue
  const current = activeMedia
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState(Boolean(preferences.muted))
  const [liked, setLiked] = useState(false)
  const [following, setFollowing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [progress, setProgress] = useState(0)
  const [drag, setDrag] = useState(0)
  const [heartBurst, setHeartBurst] = useState(false)
  const [activeSourceIndex, setActiveSourceIndex] = useState(0)
  const [downloadOpen, setDownloadOpen] = useState(false)

  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const itemsRef = useRef(items)
  const indexRef = useRef(playerIndex)
  itemsRef.current = items
  indexRef.current = playerIndex
  const wantPlayingRef = useRef(true)
  const startY = useRef<number | null>(null)
  const wheelAccRef = useRef(0)
  const stepLockRef = useRef(false)
  const lastTapRef = useRef(0)
  const singleTapTimer = useRef<number | null>(null)
  const refreshAttempted = useRef(false)

  const currentVideo = useCallback(
    (): HTMLVideoElement | undefined => videoRefs.current.get(itemsRef.current[indexRef.current]?.id ?? ''),
    []
  )

  const candidatesFor = useCallback(
    (item: MediaItem): string[] => playbackCandidates(item),
    []
  )
  const activeCandidates = current ? candidatesFor(current) : []
  const source = activeCandidates[activeSourceIndex] ?? activeCandidates[0]

  /** Feed cards can arrive without direct media URLs; resolve them at play time. */
  const ensureDirectSource = useCallback(async (): Promise<void> => {
    if (refreshAttempted.current) return
    refreshAttempted.current = true
    const merged = await refreshActiveMedia()
    if (!merged || candidatesFor(merged).length === 0) notify('Using the public embed for this clip', 'error')
  }, [candidatesFor, notify, refreshActiveMedia])

  const step = useCallback(
    (delta: -1 | 1): void => {
      if (stepLockRef.current) return
      const next = Math.min(Math.max(indexRef.current + delta, 0), Math.max(itemsRef.current.length - 1, 0))
      if (next === indexRef.current) return
      wantPlayingRef.current = true
      stepLockRef.current = true
      stepPlayer(delta)
      window.setTimeout(() => {
        stepLockRef.current = false
        wheelAccRef.current = 0
      }, STEP_LOCK_MS)
    },
    [stepPlayer]
  )

  // Per-clip reset + start playback; reflect the shared like/save/follow state.
  useEffect(() => {
    if (!current) return
    // A freshly opened or stepped-to clip always autoplays — the flag only
    // remembers a pause within the same clip. Without this, pausing one clip
    // and opening another from a grid would start it paused.
    wantPlayingRef.current = true
    setProgress(0)
    setActiveSourceIndex(0)
    refreshAttempted.current = false
    setDownloadOpen(false)
    setLiked(isLiked(current.id))
    setSaved(isSaved(current.id))
    setFollowing(isFollowing(current.creator))
    if (current.id.startsWith('hp-') || (!current.videoUrl && !current.videoUrlSd && !current.previewUrl)) void ensureDirectSource()
    for (const [id, v] of videoRefs.current) {
      if (id !== current.id) {
        v.pause()
        if (v.currentTime !== 0) v.currentTime = 0
      }
    }
    const v = currentVideo()
    if (v && wantPlayingRef.current) {
      v.muted = muted
      v.currentTime = 0
      v.play().then(() => setPlaying(true)).catch(() => {
        // Browser blocked audible autoplay: fall back to muted autoplay so the
        // clip still starts instead of showing as paused.
        v.muted = true
        setMuted(true)
        void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  useEffect(() => {
    const v = currentVideo()
    if (v) v.muted = muted
    updatePreferences({ muted })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted])

  const togglePlay = useCallback((): void => {
    const v = currentVideo()
    if (!v) return
    if (v.paused) {
      wantPlayingRef.current = true
      void v.play().catch(() => setPlaying(false))
    } else {
      wantPlayingRef.current = false
      v.pause()
    }
  }, [currentVideo])

  const likeFromDoubleTap = useCallback((): void => {
    if (!current || liked) {
      setHeartBurst(true)
      window.setTimeout(() => setHeartBurst(false), 600)
      return
    }
    setHeartBurst(true)
    window.setTimeout(() => setHeartBurst(false), 600)
    toggleLike(current)
    setLiked(true)
  }, [current, liked, toggleLike])

  const onVideoTap = useCallback((): void => {
    const now = Date.now()
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      // Double tap: cancel the pending single-tap action so a like never
      // pauses the clip (Instagram behaviour).
      lastTapRef.current = 0
      if (singleTapTimer.current !== null) {
        window.clearTimeout(singleTapTimer.current)
        singleTapTimer.current = null
      }
      likeFromDoubleTap()
    } else {
      lastTapRef.current = now
      if (singleTapTimer.current !== null) window.clearTimeout(singleTapTimer.current)
      singleTapTimer.current = window.setTimeout(() => {
        singleTapTimer.current = null
        if (lastTapRef.current !== 0) {
          lastTapRef.current = 0
          togglePlay()
        }
      }, DOUBLE_TAP_MS)
    }
  }, [likeFromDoubleTap, togglePlay])

  async function share(): Promise<void> {
    if (!current) return
    const payload = { title: current.title, text: `@${current.creator} on X-sutra`, url: current.sourceUrl }
    try {
      if (navigator.share) {
        await navigator.share(payload)
        notify('Share sheet opened', 'success')
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(current.sourceUrl)
        notify('Source link copied', 'success')
      } else {
        notify('Sharing is not supported by this browser', 'error')
      }
    } catch {
      // User cancelling the native share sheet is not an error.
    }
  }

  const goCreator = (): void => {
    if (!current) return
    closePlayer()
    navigate(`/creator/${encodeURIComponent(current.creator)}`)
  }

  const goTag = (tag: string): void => {
    closePlayer()
    navigate(`/tag/${encodeURIComponent(tag)}`)
  }

  // --- gestures -------------------------------------------------------------
  const onTouchStart = (event: React.TouchEvent): void => {
    startY.current = event.touches[0]?.clientY ?? null
  }
  const onTouchMove = (event: React.TouchEvent): void => {
    if (startY.current === null) return
    let delta = (event.touches[0]?.clientY ?? startY.current) - startY.current
    // Rubber-band resistance at the ends, like Instagram's deck.
    const atStart = indexRef.current <= 0
    const atEnd = indexRef.current >= itemsRef.current.length - 1
    if (delta > 0 && atStart) delta *= 0.35
    if (delta < 0 && atEnd) delta *= 0.35
    setDrag(delta)
  }
  const onTouchEnd = (): void => {
    if (startY.current === null) return
    const h = window.innerHeight
    if (drag < -h * SWIPE_COMMIT) step(1)
    else if (drag > h * SWIPE_COMMIT) step(-1)
    startY.current = null
    setDrag(0)
  }
  const onWheel = (event: React.WheelEvent): void => {
    if (stepLockRef.current) return
    wheelAccRef.current += event.deltaY
    if (Math.abs(wheelAccRef.current) >= WHEEL_STEP_PX) {
      const dir: -1 | 1 = wheelAccRef.current > 0 ? 1 : -1
      wheelAccRef.current = 0
      step(dir)
    }
  }

  // Keyboard for desktop-style testing.
  useEffect(() => {
    if (!current) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePlayer()
      else if (event.key === 'ArrowDown') step(1)
      else if (event.key === 'ArrowUp') step(-1)
      else if (event.key === ' ') {
        event.preventDefault()
        togglePlay()
      }
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, closePlayer, step, togglePlay])

  if (!current) {
    return null
  }


  const handleSlideError = (item: MediaItem, isCurrentSlide: boolean): void => {
    if (!isCurrentSlide) return
    const candidates = candidatesFor(item)
    if (activeSourceIndex < candidates.length - 1) {
      setActiveSourceIndex(activeSourceIndex + 1)
      return
    }
    if (!refreshAttempted.current) {
      void ensureDirectSource()
    }
  }

  // Keep one extra upcoming slide mounted so consecutive swipes stay instant.
  const first = Math.max(0, playerIndex - 1)
  const slides = playerQueue.slice(first, Math.min(playerQueue.length, playerIndex + 3))

  return (
    <div
      className="player"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onWheel={onWheel}
    >
      <div className="player-deck">
        {slides.map((item, slideIndex) => {
          const queueIndex = first + slideIndex
          const isCurrent = queueIndex === playerIndex
          const offset = (queueIndex - playerIndex) * 100
          const itemSource = isCurrent
            ? source ?? undefined
            : item.videoUrl ?? item.videoUrlSd ?? undefined
          // Tiered preload: the current and next clip download fully, slides
          // further out only load metadata — four parallel full downloads were
          // starving the playing clip's bandwidth (heavy buffering).
          const preloadFor = queueIndex === playerIndex || queueIndex === playerIndex + 1 ? 'auto' : 'metadata'
          return (
            <div
              key={item.id}
              className="player-slide"
              style={{
                transform: `translateY(calc(${offset}% + ${drag}px))`,
                transition: startY.current !== null ? 'none' : undefined
              }}
            >
              {itemSource ? (
                <video
                  ref={(element) => {
                    if (element) videoRefs.current.set(item.id, element)
                    else videoRefs.current.delete(item.id)
                  }}
                  className="player-video"
                  src={itemSource}
                  poster={item.thumbnail}
                  loop
                  playsInline
                  muted={!isCurrent || muted}
                  preload={preloadFor}
                  autoPlay={isCurrent}
                  onClick={isCurrent ? onVideoTap : undefined}
                  onError={() => handleSlideError(item, isCurrent)}
                  onTimeUpdate={
                    isCurrent
                      ? (event) => {
                        const v = event.currentTarget
                        if (v.duration) setProgress(v.currentTime / v.duration)
                      }
                      : undefined
                  }
                  onPlay={isCurrent ? () => setPlaying(true) : undefined}
                  onPause={isCurrent ? () => setPlaying(false) : undefined}
                />
              ) : (
                <div className="player-video" style={{ display: 'grid', placeItems: 'center', background: '#000' }}>
                  {isCurrent && <span className="player-chip">Loading…</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="player-scrim" />

      {heartBurst && (
        <div className="player-heart-burst" aria-hidden="true">
          <HeartIcon filled size={120} style={{ fill: 'var(--p-ember)', stroke: 'var(--p-ember)' }} />
        </div>
      )}

      {!playing && (
        <div className="player-paused" aria-hidden="true">
          <PlayIcon size={66} />
        </div>
      )}

      <div className="player-top">
        <span className="player-chip">
          Clips · {playerIndex + 1}/{playerQueue.length || 1}
        </span>
        <button className="player-close" onClick={closePlayer} aria-label="Close">
          <CloseIcon size={22} />
        </button>
      </div>

      <div className="player-rail">
        <RailBtn label="Like" on={liked} onClick={() => { if (!current) return; toggleLike(current); setLiked(!liked) }}>
          <HeartIcon filled={liked} size={24} style={liked ? { fill: 'var(--p-ember)', stroke: 'var(--p-ember)' } : undefined} />
        </RailBtn>
        <RailBtn label={muted ? 'Muted' : 'Sound'} onClick={() => setMuted((m) => !m)}>
          {muted ? <MuteIcon size={24} /> : <VolumeIcon size={24} />}
        </RailBtn>
        <RailBtn label="Share" onClick={() => void share()}>
          <ShareIcon size={24} />
        </RailBtn>
        <RailBtn label={saved ? 'Saved' : 'Save'} on={saved} onClick={() => { if (!current) return; toggleSaved(current); setSaved(!saved) }}>
          <BookmarkIcon filled={saved} size={24} style={saved ? { fill: 'var(--p-ember)', stroke: 'var(--p-ember)' } : undefined} />
        </RailBtn>
        <RailBtn label="Download" onClick={() => setDownloadOpen(true)}>
          <span className="player-dl">
            <DownloadIcon size={24} />
            <i>👑</i>
          </span>
        </RailBtn>
      </div>

      <div className="player-info">
        <div className="player-id">
          <button
            className={`player-follow${following ? ' on' : ''}`}
            onClick={() => {
              if (!current) return
              toggleFollow({ username: current.creator, displayName: current.creator, followers: 0, gifs: 0, views: 0, verified: false })
              setFollowing(!following)
            }}
            aria-label={following ? 'Following — tap to unfollow' : 'Follow'}
          >
            <UserIcon size={24} />
            <span className="player-follow-badge">{following ? <CheckIcon size={12} /> : <PlusIcon size={12} />}</span>
          </button>
          <div className="player-id-text">
            <button className="player-handle" onClick={goCreator}>@{current.creator}</button>
            <div className="player-stats">
              {compactNumber(current.views)} views · {durationLabel(current.duration)}
            </div>
          </div>
        </div>
        {current.tags.length > 0 && (
          <div className="player-tags">
            {current.tags.slice(0, 6).map((tag) => (
              <button key={tag} className="player-tag" onClick={() => goTag(tag)}>
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="player-scrub"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      {downloadOpen && current && (
        <DownloadGate
          item={current}
          onClose={() => setDownloadOpen(false)}
          onNormalDownload={(item) => { void requestDownload(item) }}
        />
      )}
    </div>
  )
}

function RailBtn({
  label,
  on,
  onClick,
  children
}: {
  label: string
  on?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={{ textAlign: 'center' }}>
      <button className={`player-rail-btn ${on ? 'on' : ''}`} onClick={onClick} aria-label={label}>
        {children}
      </button>
      <div className="player-rail-label">{label}</div>
    </div>
  )
}
