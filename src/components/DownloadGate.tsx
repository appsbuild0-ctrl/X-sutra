import { useEffect, useState } from 'react'
import type { MediaItem } from '../types'
import { OWNER_CONTACT } from '../lib/ownerContact'

type GateView = 'pick' | 'wait' | 'saving' | 'done' | 'failed' | 'premium'

/** Download gate.
 *  - Normal Download (top): free, 20 second wait, saves via the app pipeline.
 *  - Premium Download (bottom): opens a Discord / Telegram contact panel only. */
export function DownloadGate({
  item,
  onClose,
  onNormalDownload,
}: {
  item: MediaItem
  onClose: () => void
  onNormalDownload: (item: MediaItem) => Promise<boolean>
  userRole?: string | null
}): React.JSX.Element {
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

  const runNormalDownload = (): void => {
    setView('saving')
    void onNormalDownload(item).then((ok) => setView(ok ? 'done' : 'failed')).catch(() => setView('failed'))
  }

  useEffect(() => {
    if (view !== 'wait' || seconds > 0) return
    runNormalDownload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, seconds])

  const openContact = (url: string): void => {
    const win = window.open(url, '_blank', 'noopener,noreferrer')
    if (win) win.focus()
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
              <strong>Premium Download 👑</strong>
              <small>Owner se contact karo — Discord / Telegram</small>
            </button>
          </>
        )}
        {view === 'premium' && (
          <>
            <p className="eyebrow">Premium Download</p>
            <h2>Contact owner</h2>
            <p>Premium access ke liye niche diye channels pe owner se contact karein.</p>
            <button className="dl-contact" type="button" onClick={() => openContact(OWNER_CONTACT.discord)}>
              <span aria-hidden="true">💬</span>
              <span>
                <strong>Discord</strong>
                <small>{OWNER_CONTACT.discord.replace(/^https?:\/\//, '')}</small>
              </span>
            </button>
            <button className="dl-contact" type="button" onClick={() => openContact(OWNER_CONTACT.telegram)}>
              <span aria-hidden="true">✈️</span>
              <span>
                <strong>Telegram</strong>
                <small>{OWNER_CONTACT.telegram.replace(/^https?:\/\//, '')}</small>
              </span>
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
        <button className="secondary-button" type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
