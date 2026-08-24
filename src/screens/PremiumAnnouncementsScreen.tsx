import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScreenHeader } from '../components/ScreenHeader'
import { fetchPremiumCatalog, type PremiumCatalog } from '../lib/premium'

export function PremiumAnnouncementsScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)
  useEffect(() => { void fetchPremiumCatalog().then(setCatalog) }, [])
  const items = catalog?.announcements ?? []

  return (
    <section className="screen screen--ott">
      <ScreenHeader title="Announcements" eyebrow="Premium news" />
      {items.length ? (
        <div className="premium-announcements">
          {items.map((item) => (
            <button
              key={item.id}
              className="premium-announcement"
              type="button"
              onClick={() => {
                if (item.kind === 'album' && item.target) navigate(`/premium/album/${item.target}`)
                else if (item.kind === 'channel' && item.target) navigate(`/premium/channel/${item.target}`)
                else if (item.kind === 'video') navigate('/premium/videos')
                else navigate('/premium')
              }}
            >
              <strong>📢 {item.title}</strong>
              <p>{item.detail}</p>
              <small>{new Date(item.createdAt).toLocaleString('en-IN')}</small>
            </button>
          ))}
        </div>
      ) : <div className="empty-state"><strong>No announcements yet.</strong></div>}
    </section>
  )
}
