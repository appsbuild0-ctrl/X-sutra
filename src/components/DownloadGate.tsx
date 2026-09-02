import { useEffect, useState } from 'react'
import type { MediaItem } from '../types'

type GateView = 'pick' | 'wait' | 'saving' | 'done' | 'failed'

/** Download gate with premium-aware flow.
 *  - Premium/VIP users: Direct download without wait
 *  - Free users: 20 second wait for free download */
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

  // Determine if user is premium based on role
  const isPremium = userRole === 'premium' || userRole === 'vip' || userRole === 'admin'

  useEffect(() => {
    if (view !== 'wait') return
    setSeconds(20)
    const timer = window.setInterval(() => {
      setSeconds((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [view])

  const runDownload = (): void => {
    setView('saving')
    void onNormalDownload(item).then((ok) => setView(ok ? 'done' : 'failed')).catch(() => setView('failed'))
  }

  // Premium users skip the wait and download directly
  useEffect(() => {
    if (view !== 'wait' || seconds > 0 || !isPremium) return
    // For premium users, go straight to download after a very short delay
    // or immediately if view is still pick
    if (isPremium) {
      setView('saving')
      void runDownload()
    }
  }, [view, seconds, isPremium])

  useEffect(() => {
    if (view !== 'wait' || seconds > 0) return
    runDownload()
  }, [view, seconds])

  return (
    <div className="dl-gate" onClick={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
      <div className="dl-gate__card">
        {view === 'pick' && (
          <>
            <p className="eyebrow">Download panel</p>
            <h2>Download</h2>
            {isPremium ? (
              // Premium users get direct download option
              <button className="dl-option" type="button" onClick={() => setView('wait')}>
                <strong>Premium Download</strong>
                <small>Direct download • No wait</small>
              </button>
            ) : (
              // Free users get the wait option
              <button className="dl-option" type="button" onClick={() => setView('wait')}>
                <strong>Normal Download</strong>
                <small>Free Download • 20 sec wait</small>
              </button>
            )}
          </>
        )}
        {view === 'wait' && (
          <>
            <p className="eyebrow">Normal Download</p>
            <h2>{seconds === 20 ? 'Downloading available in 20s' : `${seconds}s`}</h2>
            <p>Countdown ke baad file automatically gallery / device pe save hogi.</p>
            {isPremium && (
              <p className="hint">
                <strong>Premium users:</strong> Direct download available (no wait)
              </p>
            )}
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
        {isPremium && view === 'pick' && (
          <p className="hint">
            <strong>Premium benefit:</strong> No wait timer • Direct download • Immediate save
          </p>
        )}
        <button className="secondary-button" type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}