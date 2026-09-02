import { useEffect, useState } from 'react'
import type { MediaItem } from '../types'
import { useApp } from '../context/AppContext'

type GateView = 'pick' | 'wait' | 'saving' | 'done' | 'failed'
type DownloadSource = 'redgrab' | 'discord' | 'telegram' | 'browser'

/** Download gate with premium-aware flow and Discord/Telegram options.
 *  - Premium/VIP users: Direct download without wait, can choose source
 *  - Free users: 20 second wait for free download from RedGrab */
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
  const { notify } = useApp()
  const [view, setView] = useState<GateView>('pick')
  const [seconds, setSeconds] = useState(20)

  // Determine if user is premium based on role
  const isPremium = userRole === 'premium' || userRole === 'vip' || userRole === 'admin'

  // Determine available download sources based on user role
  const availableSources = isPremium ? ['redgrab', 'discord', 'telegram'] : ['redgrab']

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

  // Premium users skip the wait and download directly, or choose source
  useEffect(() => {
    if (view !== 'wait' || seconds > 0 || !isPremium) return
    // For premium users, go straight to download after a very short delay
    if (isPremium) {
      setView('saving')
      void runNormalDownload()
    }
  }, [view, seconds, isPremium])

  useEffect(() => {
    if (view !== 'wait' || seconds > 0) return
    runNormalDownload()
  }, [view, seconds])

  // Handle source selection - Discord/Telegram open the real media URL,
  // RedGrab starts the normal download process
  const handleSourceSelect = (source: string): void => {
    if (source === 'discord' || source === 'telegram') {
      // For Discord/Telegram, open the real media URL in browser
      const mediaUrl = item.sourceUrl || item.previewUrl || item.videoUrl || item.videoUrlSd
      if (mediaUrl) {
        const win = window.open(mediaUrl, '_blank')
        if (win) {
          win.focus()
        }
        setView('done')
        setSeconds(0)
      } else {
        const fallbackUrl = item.videoUrl || item.videoUrlSd || item.previewUrl
        if (fallbackUrl) {
          const win = window.open(fallbackUrl, '_blank')
          if (win) {
            win.focus()
          }
          setView('done')
          setSeconds(0)
        } else {
          notify('This clip does not have an available source URL for direct download', 'error')
        }
      }
    } else if (source === 'redgrab') {
      // For RedGrab, start the normal download process
      setView('saving')
      void runNormalDownload()
    }
  }

  // Premium users get a direct, no-wait download
  const handlePremiumDownload = (): void => {
    if (isPremium) {
      runNormalDownload()
    } else {
      setView('wait')
    }
  }

  return (
    <div className="dl-gate" onClick={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
      <div className="dl-gate__card">
        {view === 'pick' && (
          <>
            <p className="eyebrow">Download panel</p>
            <h2>Download</h2>
            {isPremium && (
              <>
                <button className="dl-option" type="button" onClick={handlePremiumDownload}>
                  <strong>Premium Download</strong>
                  <small>Choose source • Direct download • No wait</small>
                </button>
                <div className="sources-list">
                  {availableSources.map((source) => (
                    <div key={source} className="source-item" onClick={() => handleSourceSelect(source)}>
                      <span className="source-icon">
                        {source === 'discord' && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M20.317 4.369a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                          </svg>
                        )}
                        {source === 'telegram' && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                          </svg>
                        )}
                      </span>
                      <span className="source-name">{source}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
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
            {isPremium && (
              <p className="hint">
                <strong>Premium users:</strong> Direct download available (no wait) • Can choose source: Discord, Telegram, RedGrab
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
            <strong>Premium benefit:</strong> No wait timer • Choose source: Discord, Telegram, RedGrab • Immediate save
          </p>
        )}
        <button className="secondary-button" type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
