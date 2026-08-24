import { useEffect, useState } from 'react'
import { readPayQr } from '../lib/payQr'

export type PlanId = 'premium' | 'vip'

export function PlanCards({ onPick }: { onPick: (plan: PlanId) => void }): React.JSX.Element {
  return (
    <div className="plan-grid">
      <button className="plan-card" type="button" onClick={() => onPick('premium')}>
        <strong>Premium ⭐</strong>
        <small>Premium Plan</small>
      </button>
      <button className="plan-card plan-card--vip" type="button" onClick={() => onPick('vip')}>
        <strong>VIP 💎</strong>
        <small>VIP Plan</small>
      </button>
    </div>
  )
}

export function PayQrModal({ plan, onClose }: { plan: PlanId; onClose: () => void }): React.JSX.Element {
  const qr = readPayQr()
  const [seconds, setSeconds] = useState(60)
  const expired = seconds <= 0
  const label = plan === 'vip' ? 'VIP 💎' : 'Premium ⭐'

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="pay-modal" role="dialog" aria-modal="true">
      <div className="pay-modal__card">
        <p className="eyebrow">{label}</p>
        <h2>{expired ? 'Payment expired' : label}</h2>
        {qr ? <img src={qr} alt={`${label} payment QR`} /> : <p>Admin ne QR upload nahi kiya.</p>}
        {!expired && <p>Scan QR to complete payment</p>}
        <strong className="dl-gate__timer">{expired ? 'Expired' : `Payment expires in ${seconds}s`}</strong>
        <button className="secondary-button" type="button" onClick={onClose}>CLOSE</button>
      </div>
    </div>
  )
}
