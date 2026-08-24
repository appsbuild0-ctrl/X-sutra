import { useEffect, useState } from 'react'
import { readPayQr } from '../lib/payQr'
import type { MediaItem } from '../types'

type GateView = 'pick' | 'wait' | 'plans' | 'qr'

export function DownloadGate({
  item,
  onClose,
  onNormalDownload
}: {
  item: MediaItem
  onClose: () => void
  onNormalDownload: (item: MediaItem) => void
}): React.JSX.Element {
  const [view, setView] = useState<GateView>('pick')
  const [seconds, setSeconds] = useState(20)
  const [plan, setPlan] = useState<'Premium' | 'VIP'>('Premium')
  const qr = readPayQr()

  useEffect(() => {
    if (view !== 'wait') return
    setSeconds(20)
    const timer = window.setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(timer)
          onNormalDownload(item)
          onClose()
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [view, item, onClose, onNormalDownload])

  useEffect(() => {
    if (view !== 'qr') return
    setSeconds(120)
    const timer = window.setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(timer)
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [view])

  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <div className="dl-gate" onClick={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
      <div className="dl-gate__card">
        {view === 'pick' && (
          <>
            <p className="eyebrow">Download</p>
            <h2>Kaise download karein?</h2>
            <button className="primary-button primary-button--wide" type="button" onClick={() => setView('wait')}>Normal download</button>
            <button className="secondary-button" type="button" onClick={() => setView('plans')}>Premium download 👑</button>
          </>
        )}
        {view === 'wait' && (
          <>
            <p className="eyebrow">Normal</p>
            <h2>{seconds}s</h2>
            <p>Wait ho raha hai — phir gallery / device pe save hoga.</p>
          </>
        )}
        {view === 'plans' && (
          <>
            <p className="eyebrow">Plans</p>
            <h2>Premium login</h2>
            <div className="dl-gate__plans">
              <button type="button" onClick={() => { setPlan('Premium'); setView('qr') }}>Premium ⭐</button>
              <button type="button" onClick={() => { setPlan('VIP'); setView('qr') }}>VIP 💎</button>
            </div>
          </>
        )}
        {view === 'qr' && (
          <div className="dl-gate__pay">
            <div>
              <p className="eyebrow">{plan}</p>
              {qr ? <img src={qr} alt="Payment QR" /> : <p>Admin ne QR upload nahi kiya.</p>}
            </div>
            <strong className="dl-gate__timer">{clock}</strong>
          </div>
        )}
        <button className="secondary-button" type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
