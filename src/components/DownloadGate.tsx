import { useEffect, useState } from 'react'
import type { MediaItem } from '../types'
import { OWNER_CONTACT } from '../lib/ownerContact'

type GateView = 'pick' | 'wait' | 'saving' | 'done' | 'failed' | 'premium'

/** Download gate.
 *  - Premium/VIP/admin (top): instant "Download Now 👑" straight through the save pipeline.
 *  - Free (top): 20 second wait, then saves via the app pipeline.
 *  - Owner Contact (bottom): always offers Discord / Telegram support links. */
export function DownloadGate({
  item,
  onClose,
  onNormalDownload,
  userRole,
}: {
  item: MediaItem
  onClose: () => void
  onNormalDownload: (item: MediaItem) => Promise<boolean>
  userRole?: string | null
}): React.JSX.Element {
  const [view, setView] = useState<GateView>('pick')
  const [seconds, setSeconds] = useState(20)
  const premium = userRole === 'premium' || userRole === 'vip' || userRole === 'admin'

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
            {premium ? (
              <button className="dl-option dl-option--gold" type="button" onClick={runNormalDownload}>
                <strong>Download Now 👑</strong>
                <small>Premium / VIP • instant download</small>
              </button>
            ) : (
              <button className="dl-option" type="button" onClick={() => setView('wait')}>
                <strong>Normal Download</strong>
                <small>Free Download • 20 sec wait</small>
              </button>
            )}
            <button className="dl-option" type="button" onClick={() => setView('premium')}>
              <strong>{premium ? 'Owner Contact' : 'Premium Download 👑'}</strong>
              <small>Discord / Telegram — owner se contact karo</small>
            </button>
          </>
        )}
        {view === 'premium' && (
          <>
            <p className="eyebrow">Owner contact</p>
            <h2>{premium ? 'Contact / support' : 'Premium access'}</h2>
            <p>Niche diye Discord / Telegram channels pe owner se contact karein.</p>
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
            <button className="primary-button primary-button--wide" type="button" onClick={() => { if (premium) runNormalDownload(); else { setSeconds(20); setView('wait') } }}>Try Again</button>
          </>
        )}
        <button className="secondary-button" type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
