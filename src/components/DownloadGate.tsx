import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MediaItem } from '../types'
import { DiscordIcon, TelegramIcon } from './icons'

const CONTACT_MESSAGE = 'Hey Premium or Vip Plans How much ❤️'
const DISCORD_USER = 'godxeye0'
const TELEGRAM_USER = 'godxeye0'

type GateView = 'pick' | 'wait' | 'saving' | 'done' | 'failed' | 'premium'

async function openExternal(url: string): Promise<void> {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function DownloadGate({
  item,
  onClose,
  onNormalDownload,
  onBuyNow
}: {
  item: MediaItem
  onClose: () => void
  onNormalDownload: (item: MediaItem) => Promise<boolean>
  onBuyNow?: () => void
}): React.JSX.Element {
  const navigate = useNavigate()
  const [view, setView] = useState<GateView>('pick')
  const [seconds, setSeconds] = useState(20)

  useEffect(() => {
    if (view !== 'wait') return
    setSeconds(20)
    const timer = window.setInterval(() => {
      setSeconds((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [view])

  useEffect(() => {
    if (view !== 'wait' || seconds > 0) return
    let live = true
    setView('saving')
    void onNormalDownload(item).then((ok) => {
      if (live) setView(ok ? 'done' : 'failed')
    }).catch(() => {
      if (live) setView('failed')
    })
    return () => { live = false }
  }, [view, seconds, item, onNormalDownload])

  const openDiscord = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(`${CONTACT_MESSAGE}\n@${DISCORD_USER}`) } catch { /* clipboard optional */ }
    await openExternal(`https://discord.com/users/${DISCORD_USER}`)
  }

  const openTelegram = async (): Promise<void> => {
    await openExternal(`https://t.me/${TELEGRAM_USER}?text=${encodeURIComponent(CONTACT_MESSAGE)}`)
  }

  return (
    <div className="dl-gate" onClick={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
      <div className="dl-gate__card">
        {view === 'pick' && (
          <>
            <p className="eyebrow">Download panel</p>
            <h2>Download</h2>
            <button className="dl-option" type="button" onClick={() => setView('wait')}>
              <strong>Normal Download</strong>
              <small>Free Download • 20 sec wait</small>
            </button>
            <button className="dl-option dl-option--gold" type="button" onClick={() => setView('premium')}>
              <strong>Premium Download ⭐</strong>
              <small>Get instant/premium access</small>
            </button>
          </>
        )}
        {view === 'wait' && (
          <>
            <p className="eyebrow">Normal Download</p>
            <h2>{seconds === 20 ? 'Downloading available in 20s' : `${seconds}s`}</h2>
            <p>Countdown ke baad file automatically gallery / device pe save hogi.</p>
            <button className="primary-button primary-button--wide" type="button" disabled>Waiting…</button>
          </>
        )}
        {view === 'saving' && (
          <>
            <p className="eyebrow">Normal Download</p>
            <h2>Saving…</h2>
            <p>Actual video source se download ho raha hai.</p>
          </>
        )}
        {view === 'done' && (
          <>
            <p className="eyebrow">Normal Download</p>
            <h2>Download completed ✓</h2>
          </>
        )}
        {view === 'failed' && (
          <>
            <p className="eyebrow">Normal Download</p>
            <h2>Download failed — Try Again</h2>
            <button className="primary-button primary-button--wide" type="button" onClick={() => { setSeconds(20); setView('wait') }}>Try Again</button>
          </>
        )}
        {view === 'premium' && (
          <>
            <p className="eyebrow">Premium Download ⭐</p>
            <h2>Choose where you want to contact us</h2>
            <button className="dl-contact" type="button" onClick={() => void openDiscord()}>
              <DiscordIcon size={22} />
              <span><strong>Discord</strong><small>Username: {DISCORD_USER}</small></span>
            </button>
            <button className="dl-contact" type="button" onClick={() => void openTelegram()}>
              <TelegramIcon size={22} />
              <span><strong>Telegram</strong><small>Username: {TELEGRAM_USER}</small></span>
            </button>
            <p className="form-help">Message: {CONTACT_MESSAGE}</p>
            <button
              className="primary-button primary-button--wide"
              type="button"
              onClick={() => {
                if (onBuyNow) onBuyNow()
                else { onClose(); navigate('/login') }
              }}
            >
              BUY NOW
            </button>
          </>
        )}
        <button className="secondary-button" type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
