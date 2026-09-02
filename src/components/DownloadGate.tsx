import { useEffect, useState } from 'react'
import type { MediaItem } from '../types'

type GateView = 'pick' | 'wait' | 'saving' | 'done' | 'failed'

export function DownloadGate({
  item,
  onClose,
  onNormalDownload
}: {
  item: MediaItem
  onClose: () => void
  onNormalDownload: (item: MediaItem) => Promise<boolean>
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

  const runDownload = (): void => {
    setView('saving')
    void onNormalDownload(item).then((ok) => setView(ok ? 'done' : 'failed')).catch(() => setView('failed'))
  }

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
            <button className="dl-option" type="button" onClick={() => setView('wait')}>
              <strong>Normal Download</strong>
              <small>Free Download • 20 sec wait</small>
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
