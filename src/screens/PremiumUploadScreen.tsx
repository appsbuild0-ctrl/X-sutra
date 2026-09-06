import { useNavigate } from 'react-router-dom'
import { ScreenHeader } from '../components/ScreenHeader'
import { useApp } from '../context/AppContext'
import { PremiumAdmin } from './PremiumAdmin'

export function PremiumUploadScreen(): React.JSX.Element {
  const { account } = useApp()
  const navigate = useNavigate()
  if (account?.role !== 'admin') {
    return (
      <section className="screen screen--ott">
        <ScreenHeader title="Upload" eyebrow="Admin only" />
        <div className="empty-state"><strong>Upload is only for admin.</strong><button className="primary-button" type="button" onClick={() => navigate('/premium')}>Back to Premium</button></div>
      </section>
    )
  }
  return (
    <section className="screen screen--ott">
      <ScreenHeader title="Premium Upload" eyebrow="Admin" />
      <PremiumAdmin />
    </section>
  )
}
