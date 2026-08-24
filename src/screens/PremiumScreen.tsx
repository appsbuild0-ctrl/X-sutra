import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScreenHeader } from '../components/ScreenHeader'
import { PlayIcon, ShieldIcon, SparkIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { fetchPremiumPosts, premiumPostToMedia, type PremiumPost } from '../lib/premium'

/** Premium preview — feature pitch while the plan itself is coming soon. */
export function PremiumScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { account, openPlayer } = useApp()
  const [posts, setPosts] = useState<PremiumPost[]>([])

  useEffect(() => {
    void fetchPremiumPosts().then(setPosts)
  }, [])

  const perks = [
    { icon: <SparkIcon size={18} />, title: 'HD downloads, no limits', copy: 'Save every public clip at full quality with priority speeds.' },
    { icon: <ShieldIcon size={18} />, title: 'Ad-free, distraction-free', copy: 'A pure full-screen feed with nothing between you and the videos.' },
    { icon: <SparkIcon size={18} />, title: 'Exclusive feeds', copy: 'Premium-only trending lists and early access to new features.' },
    { icon: <ShieldIcon size={18} />, title: 'Backup your library', copy: 'Keep your saves, follows and collections safe across devices.' }
  ]

  return (
    <section className="screen screen--premium">
      <ScreenHeader title="Premium" eyebrow="X-sutra upgrade" actions={<button className="round-button" type="button" onClick={() => navigate(-1)} aria-label="Go back">‹</button>} />

      <div className="premium-hero">
        <span className="premium-hero__badge">✦</span>
        <div>
          <p className="eyebrow">Coming soon</p>
          <h2>X-sutra Premium</h2>
          <p>The smoothest way to browse, watch and save. Unlock everything below in one upgrade.</p>
        </div>
      </div>

      <div className="premium-list">
        {perks.map((perk) => (
          <div className="premium-row" key={perk.title}>
            <span className="premium-row__icon">{perk.icon}</span>
            <div>
              <strong>{perk.title}</strong>
              <p>{perk.copy}</p>
            </div>
          </div>
        ))}
      </div>

      {posts.length > 0 && (
        <>
          <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Member exclusives</p><h3>Premium clips</h3></div><span>{posts.length} clips</span></div>
          <div className="premium-posts">
            {posts.map((post) => (
              <button
                key={post.id}
                type="button"
                className="premium-post"
                onClick={() => openPlayer(premiumPostToMedia(post), posts.map(premiumPostToMedia))}
              >
                <span className="premium-post__thumb" style={post.thumbnail ? { backgroundImage: `url(${post.thumbnail})` } : undefined}>
                  <PlayIcon size={26} />
                </span>
                <strong>{post.title}</strong>
                <small>{new Date(post.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small>
              </button>
            ))}
          </div>
        </>
      )}

      <button
        className="home-cta home-cta--premium home-cta--wide"
        type="button"
        onClick={() => navigate(account ? '/you' : '/login')}
      >
        {account ? `You're signed in as ${account.name}` : 'Sign in to get notified first'}
      </button>
      <p className="form-help" style={{ textAlign: 'center' }}>Premium is not live yet — nothing to pay right now.</p>
    </section>
  )
}
