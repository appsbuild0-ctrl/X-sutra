import { useRef, useState, type ReactNode } from 'react'

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void
  children: ReactNode
}

const RING = 2 * Math.PI * 9

/** Instagram-style touch pull-to-refresh: a circular progress spinner that
 *  fills as you pull, snaps into a continuous spin while refreshing. */
export function PullToRefresh({ onRefresh, children }: PullToRefreshProps): React.JSX.Element {
  const startY = useRef<number | null>(null)
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const threshold = 72

  const onTouchStart = (event: React.TouchEvent) => {
    if (window.scrollY <= 2 && !refreshing) startY.current = event.touches[0]?.clientY ?? null
  }

  const onTouchMove = (event: React.TouchEvent) => {
    if (startY.current === null || refreshing) return
    const delta = Math.max(0, (event.touches[0]?.clientY ?? startY.current) - startY.current)
    setDistance(Math.min(delta * 0.52, 110))
  }

  const onTouchEnd = () => {
    if (startY.current === null) return
    const shouldRefresh = distance >= threshold
    startY.current = null
    setDistance(0)
    if (!shouldRefresh || refreshing) return
    setRefreshing(true)
    Promise.resolve(onRefresh()).finally(() => window.setTimeout(() => setRefreshing(false), 420))
  }

  const active = refreshing || distance > 0
  const progress = Math.min(1, distance / threshold)

  return (
    <div className="pull-refresh" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {active && (
        <div className="ptr-spinner" style={{ opacity: refreshing ? 1 : Math.max(0.25, progress) }}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 22 22"
            className={refreshing ? 'is-spinning' : undefined}
            style={refreshing ? undefined : { transform: `rotate(${distance * 1.6}deg)` }}
          >
            <circle cx="11" cy="11" r="9" fill="none" stroke="rgba(255, 240, 228, 0.14)" strokeWidth="2.6" />
            <circle
              cx="11"
              cy="11"
              r="9"
              fill="none"
              stroke="#ff7b54"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeDasharray={RING}
              strokeDashoffset={refreshing ? 0 : RING * (1 - progress * 0.85)}
            />
          </svg>
        </div>
      )}
      {children}
    </div>
  )
}
