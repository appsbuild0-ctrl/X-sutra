import { useNavigate } from 'react-router-dom'
import { ScreenHeader } from '../components/ScreenHeader'
import { ShieldIcon, SparkIcon } from '../components/icons'
import { useApp } from '../context/AppContext'

/** Premium preview — feature pitch while the plan itself is coming soon. */
export function PremiumScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { account } = useApp()

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
