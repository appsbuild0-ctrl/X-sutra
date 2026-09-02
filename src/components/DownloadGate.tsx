import { useEffect, useState } from 'react'
import type { MediaItem } from '../types'

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
      // The item should have a sourceUrl or previewUrl with the real media link
      const mediaUrl = item.sourceUrl || item.previewUrl || item.videoUrl || item.videoUrlSd
      if (mediaUrl) {
        // Open in new tab/window
        const win = window.open(mediaUrl, '_blank')
        if (win) {
          win.focus()
        }
        setView('done')
        setSeconds(0)
      } else {
        // Fallback: try to get any available URL
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

  useEffect(() => {
    // Notify user about premium benefits when gate opens
    if (view === 'pick' && isPremium) {
      // Just inform, don't auto-action
    }
  }, [view, isPremium])

  return (
    <div className="dl-gate" onClick={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
      <div className="dl-gate__card">
        {view === 'pick' && (
          <>\n            <p className="eyebrow">Download panel</p>\n            <h2>Download</h2>\n            {isPremium && (\n              <>\n                <button className=\"dl-option\" type=\"button\" onClick={() => setView('wait')}>n                  <strong>Premium Download</strong>\n                  <small>Choose source • Direct download • No wait</small>\n                </button>\n                <div className=\"sources-list\">\n                  {availableSources.map((source) => (\n                    <div key={source} className=\"source-item\" onClick={() => handleSourceSelect(source)}>n                      <span className=\"source-icon\">\n                        {source === 'discord' && (\n                          <svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"currentColor\">n                            <path d=\"M16 0C7.163 0 0 7.163 0 16c0 8.837 8.163 16 16 16s16-7.163 16-16C32 7.163 24.837 0 16 0zM16 2.828l6.364 6.364L18.184 16l-1.445 1.445L16 17.828l-4.364-4.364L9.636 9.636 8 11.08l5.365 5.365 1.415-1.415L16 12.343z\"/>\n                          </svg>\n                        ) : source === 'telegram' && (\n                          <svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"currentColor\">n                            <path d=\"M12 2C6.48 2 2 6.48 2 12s4.48 10 12 10 12-4.48 12-10S17.48 2 12 2zM12 4.237c-3.022 0-5.463 2.442-5.463 5.463S9.155 15.18 12 15.18s5.463-2.442 5.463-5.463S15.022 4.237 12 4.237zM12 9.583c-1.215 0-2.177.978-2.183 2.062C8.808 14.357 6 15.765 6 12S8.808 9.583 12 9.583zm5.162-3.788l-1.05 2.093L15.5 10.583l-1.048 2.093L14.453 13.077l2.188 1.688L17.5 9.312l-2.188-1.688z\"/>\n                          </svg>\n                        ) : source === 'telegram' && (\n                          <svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"currentColor\">n                            <path d=\"M22.79 6.79c.09-.33.09-1.2 0-1.53l-.12-1.06C20.21 3.96 17.77 3 14.19 3 8.12 3 4.72 3 4.9 4.34l1.57 4.78c.07.4.12.94.12 1.49v4.17l1.57-4.78c.05-1.18 1.22-2.5 3.03-3.31l4.72-1.56c.74-.25 1.49-.352 2.26-.27 1.52.06 2.92 1.28 2.29 3.07l-1.57 4.78c-.06 1.15-.81 2.53-2.37 1.28l-4.58 1.5-1.24-4.88c-.36-1.4-.04-3.1.88-4.2zM7.53 13.35c-.09-.33-.09-1.2 0-1.53l.13-1.06.6.94c.37.56.97.85 1.65.6h.05c.68-.14 1.31-.43 1.95-.85l.6-.94c.09-.33.09-1.2 0-1.53l-1.06-1.98C7.04 11.055 7 9.457 7 7.5 7 5.46 8.46 4 10.5 4h4c2.04 0 3.5 1.46 3.93 3.5l.6.94c.09.33.09 1.2 0 1.53l-1.06 1.98C17.04 13.055 16 14.557 16 16.5 16 18.46 14.54 20 12.5 20c-1.99 0-3.478-1.033-4.47-2.875l-.53-.85-.53.85c-.995 1.447-2.477 2.875-4.47 2.875zm1.5 6.35l.53-.85.53.85c.995 1.447 2.477 2.875 4.47 2.875 1.025 0 3.5-1.025 3.93-3.5l.6-.94c.09-.33.09-1.2 0-1.53l-1.06-1.98-1.06 1.98c-.52 1.017-1.093 2.06-1.617 3.075l-1.5 4.88-4.58 1.5c-.76.23-1.51.05-2.26-.27l4.72-1.56c1.81.77 3.03 2.09 3.03 3.31l1.57 4.78c.05 1.18.7 2.23 2.26 1.31l1.57-4.78c.37-.56.64-.85.65-1.17v-4.17z\"/>\n                          </svg>\n                        ) : null}\n                      </span>\n                      <span className=\"source-name\">{source}</span>\n                    </div>\n                  ))}\n                </div>\n              </>\n            )}\n            {(!isPremium || view === 'pick') && (\n              <button className=\"dl-option\" type=\"button\" onClick={() => setView('wait')}>n                <strong>Normal Download</strong>\n                <small>Free Download • 20 sec wait</small>\n              </button>\n            )}\n          </>\n        )}\n        {view === 'wait' && (\n          <>\n            <p className=\"eyebrow\">Normal Download</p>\n            <h2>{seconds === 20 ? 'Downloading available in 20s' : `${seconds}s`}</h2>\n            <p>Countdown ke baad file automatically gallery / device pe save hogi.</p>\n            {isPremium && (\n              <p className=\"hint\">n                <strong>Premium users:</strong> Direct download available (no wait) • Can choose source: Discord, Telegram, RedGrabn              </p>\n            )}\n            <button className=\"primary-button primary-button--wide\" type=\"button\" disabled>Waiting…</button>\n          </>\n        )}\n        {view === 'saving' && (\n          <>\n            <p className=\"eyebrow\">Normal Download</p>\n            <h2>Saving…</h2>\n            <p>Actual video source se download ho raha hai.</p>\n          </>\n        )}\n        {view === 'done' && (\n          <>\n            <p className=\"eyebrow\">Normal Download</p>\n            <h2>Download completed ✓</h2>\n          </>\n        )}\n        {view === 'failed' && (\n          <>\n            <p className=\"eyebrow\">Normal Download</p>\n            <h2>Download failed — Try Again</h2>\n            <button className=\"primary-button primary-button--wide\" type=\"button\" onClick={() => { setSeconds(20); setView('wait') }}>Try Again</button>\n          </>\n        )}\n        {isPremium && view === 'pick' && (\n          <p className=\"hint\">n            <strong>Premium benefit:</strong> No wait timer • Choose source: Discord, Telegram, RedGrab • Immediate saven          </p>\n        )}\n        <button className=\"secondary-button\" type=\"button\" onClick={onClose}>Close</button>\n      </div>\n    </div>\n  )\n)\n\n/** Handle source selection - Discord/Telegram open real media URL, RedGrab starts download */\nfunction handleSourceSelect(source: string): void {\n  if (source === 'discord' || source === 'telegram') {\n    // For Discord/Telegram, open the real media URL in browser\n    const mediaUrl = item.sourceUrl || item.previewUrl || item.videoUrl || item.videoUrlSd\n    if (mediaUrl) {\n      const win = window.open(mediaUrl, '_blank')\n      if (win) {\n        win.focus()\n      }\n      setView('done')\n      setSeconds(0)\n    } else {\n      notify('This clip does not have an available source URL for direct download', 'error')\n    }\n  } else if (source === 'redgrab') {\n    // For RedGrab, start the normal download process\n    setView('saving')\n    void runNormalDownload()\n  }\n}\nEOF