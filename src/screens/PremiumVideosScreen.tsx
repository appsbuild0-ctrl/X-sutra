import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { fetchPremiumCatalog, premiumMediaToItem, type PremiumCatalog } from '../lib/premium'

export function PremiumVideosScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)
  useEffect(() => { void fetchPremiumCatalog().then(setCatalog) }, [])
  const videos = (catalog?.media ?? []).filter((item) => item.type === 'video').map(premiumMediaToItem)

  return (
    <section className="screen screen--ott">
      <ScreenHeader title="Premium Videos" eyebrow="All uploads" actions={<button className="round-button" type="button" onClick={() => navigate('/premium')} aria-label="Back">‹</button>} />
      <MediaGrid items={videos} empty={<div className="empty-state"><strong>No premium videos yet.</strong></div>} />
    </section>
  )
}
