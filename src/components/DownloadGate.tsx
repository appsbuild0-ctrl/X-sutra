import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MediaItem } from '../types'

type GateView = 'pick' | 'wait' | 'premium'

export function DownloadGate({
  item,
  onClose,
  onNormalDownload
}: {
  item: MediaItem
  onClose: () => void
  onNormalDownload: (item: MediaItem) => void
}): React.JSX.Element {
  const navigate = useNavigate()
  const [view, setView] = useState<GateView>('pick')
  const [seconds, setSeconds] = useState(20)

  useEffect(() => {
    if (view !== 'wait') return
    setSeconds(20)
    const timer = window.setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(timer)
          onNormalDownload(item)
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [view, item, onNormalDownload])

  return (
    <div className="dl-gate" onClick={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
      <div className="dl-gate__card">
        {view === 'pick' && (
          <>
            <p className="eyebrow">Download panel</p>
            <h2>Download</h2>
            <button className="primary-button primary-button--wide" type="button" onClick={() => setView('wait')}>Normal Download</button>
            <button className="secondary-button" type="button" onClick={() => setView('premium')}>Premium Download 👑</button>
          </>
        )}
        {view === 'wait' && (
          <>
            <p className="eyebrow">Normal Download</p>
            <h2>{seconds}s</h2>
            <p>20 sec ruko — phir file automatically gallery / device pe save hogi.</p>
          </>
        )}
        {view === 'premium' && (
          <>
            <p className="eyebrow">Premium Download</p>
            <h2>Contact</h2>
            <p>Discord: <strong>godxeye0</strong></p>
            <p>Telegram: <strong>godxeye0</strong></p>
            <button
              className="primary-button primary-button--wide"
              type="button"
              onClick={() => {
                onClose()
                navigate('/login')
              }}
            >
              Buy Now
            </button>
          </>
        )}
        <button className="secondary-button" type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
