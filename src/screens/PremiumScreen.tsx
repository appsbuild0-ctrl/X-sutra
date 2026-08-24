import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlayIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { addPremiumPost, fetchPremiumPosts, premiumPostToMedia, type PremiumPost } from '../lib/premium'
import { readStored, writeStored } from '../lib/storage'

const JOIN_KEY = 'x-sutra.premium.channel.joined.v1'
const VIEWS_KEY = 'x-sutra.premium.channel.views.v1'

function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

function viewCount(id: string, extra: Record<string, number>): number {
  if (extra[id]) return extra[id]
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return 120 + (hash % 4800)
}

export function PremiumScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { account, openPlayer, notify } = useApp()
  const isAdmin = account?.role === 'admin'
  const [posts, setPosts] = useState<PremiumPost[]>([])
  const [joined, setJoined] = useState(() => readStored(JOIN_KEY, true))
  const [views, setViews] = useState<Record<string, number>>(() => readStored(VIEWS_KEY, {}))
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [posting, setPosting] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void fetchPremiumPosts().then((next) => {
      setPosts([...next].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)))
    })
  }, [])

  useEffect(() => {
    writeStored(JOIN_KEY, joined)
  }, [joined])

  useEffect(() => {
    writeStored(VIEWS_KEY, views)
  }, [views])

  useEffect(() => {
    const node = scroller.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [posts.length])

  const days = useMemo(() => {
    const groups: Array<{ label: string; items: PremiumPost[] }> = []
    for (const post of posts) {
      const label = formatDay(post.createdAt)
      const last = groups[groups.length - 1]
      if (last && last.label === label) last.items.push(post)
      else groups.push({ label, items: [post] })
    }
    return groups
  }, [posts])

  const subscribers = 1840 + posts.length * 7 + (joined ? 1 : 0)

  const openPost = (post: PremiumPost) => {
    setViews((current) => ({ ...current, [post.id]: viewCount(post.id, current) + 1 }))
    openPlayer(premiumPostToMedia(post), posts.map(premiumPostToMedia))
  }

  const publish = async () => {
    if (posting) return
    setPosting(true)
    const result = await addPremiumPost('admin123', title, url.trim(), '')
    if (result.ok) {
      notify('Posted to channel', 'success')
      setTitle('')
      setUrl('')
      const next = await fetchPremiumPosts()
      setPosts([...next].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)))
    } else {
      notify(result.error ?? 'Could not post', 'error')
    }
    setPosting(false)
  }

  return (
    <section className="tg-channel">
      <header className="tg-channel__bar">
        <button className="tg-channel__back" type="button" onClick={() => navigate(-1)} aria-label="Back">‹</button>
        <span className="tg-channel__avatar" aria-hidden>X</span>
        <div className="tg-channel__meta">
          <strong>X-sutra Premium</strong>
          <small>{subscribers.toLocaleString('en-IN')} subscribers</small>
        </div>
        <button
          className={`tg-channel__join${joined ? ' is-on' : ''}`}
          type="button"
          onClick={() => {
            setJoined((current) => !current)
            notify(joined ? 'Left channel' : 'Joined X-sutra Premium', 'success')
          }}
        >
          {joined ? 'MUTE' : 'JOIN'}
        </button>
      </header>

      <div className="tg-channel__feed" ref={scroller}>
        <div className="tg-channel__about">
          <span className="tg-channel__about-mark">✦</span>
          <h2>X-sutra Premium</h2>
          <p>In-built channel. Exclusive clips drop here first — same as a Telegram channel, inside the app.</p>
          <small>channel · public drops</small>
        </div>

        {posts.length === 0 && (
          <div className="tg-bubble tg-bubble--text">
            <p>Welcome to <b>X-sutra Premium</b>. Admin posts appear here as channel messages. Tap JOIN to stay on this feed.</p>
            <time>00:00</time>
          </div>
        )}

        {days.map((group) => (
          <div key={group.label}>
            <div className="tg-day"><span>{group.label}</span></div>
            {group.items.map((post) => (
              <article className="tg-bubble" key={post.id}>
                <button className="tg-bubble__media" type="button" onClick={() => openPost(post)}>
                  <span style={post.thumbnail ? { backgroundImage: `url(${post.thumbnail})` } : undefined}>
                    <PlayIcon size={28} />
                  </span>
                </button>
                <p>{post.title}</p>
                <footer>
                  <span>{viewCount(post.id, views).toLocaleString('en-IN')} views</span>
                  <time>{formatClock(post.createdAt)}</time>
                </footer>
              </article>
            ))}
          </div>
        ))}
      </div>

      {isAdmin ? (
        <form
          className="tg-composer"
          onSubmit={(event) => {
            event.preventDefault()
            void publish()
          }}
        >
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Caption" maxLength={80} />
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Video link" inputMode="url" autoCapitalize="none" spellCheck={false} />
          <button type="submit" disabled={posting || !url.trim()}>{posting ? '…' : '➤'}</button>
        </form>
      ) : (
        <div className="tg-composer tg-composer--hint">
          Only channel admin can post. Sign in as admin to publish.
        </div>
      )}
    </section>
  )
}
