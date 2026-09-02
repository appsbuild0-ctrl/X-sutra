import { useEffect, useState } from 'react'
import { defaultHub, loadHub, type AdminHub, type PlanInfo } from '../lib/adminHub'
import { durationLabel } from '../lib/format'
import { readPayQr } from '../lib/payQr'

export type PlanId = 'premium' | 'vip'

export function PlanCards({ onPick }: { onPick: (plan: PlanId) => void }): React.JSX.Element {
  const [hub, setHub] = useState<AdminHub>(defaultHub)
  useEffect(() => { void loadHub().then(setHub) }, [])
  const Card = ({ id, plan }: { id: PlanId; plan: PlanInfo }) => plan.enabled ? (
    <button className={`plan-card${id === 'vip' ? ' plan-card--vip' : ''}`} type="button" onClick={() => onPick(id)}>
      <strong>{plan.name}</strong>
      <small>{plan.price ? `${plan.price} · ${plan.description}` : plan.description}</small>
    </button>
  ) : null
  return (
    <div className="plan-grid">
      <Card id="premium" plan={hub.plans.premium} />
      <Card id="vip" plan={hub.plans.vip} />
    </div>
  )
}

export function PayQrModal({ plan, onClose }: { plan: PlanId; onClose: () => void }): React.JSX.Element {
  const [hub, setHub] = useState<AdminHub>(defaultHub)
  // 119s window, always rendered as m:ss ("1:59" → "1:00" → "0:09"), never bare seconds.
  const [seconds, setSeconds] = useState(119)
  useEffect(() => { void loadHub().then(setHub) }, [])
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const info = hub.plans[plan]
  const qr = hub.qr || readPayQr()
  const expired = seconds <= 0
  return (
    <div className="pay-modal" role="dialog" aria-modal="true">
      <div className="pay-modal__card">
        <p className="eyebrow">{info.name}</p>
        <h2>{expired ? 'Payment expired' : info.name}</h2>
        {info.price && <p>{info.price}</p>}
        {qr ? <img src={qr} alt={`${info.name} payment QR`} /> : <p>Admin ne QR upload nahi kiya.</p>}
        {!expired && <p>Scan QR to complete payment</p>}
        <strong className="dl-gate__timer">{expired ? 'Expired' : `Payment expires in ${durationLabel(seconds)}`}</strong>
        <button className="secondary-button" type="button" onClick={onClose}>CLOSE</button>
      </div>
    </div>
  )
}
