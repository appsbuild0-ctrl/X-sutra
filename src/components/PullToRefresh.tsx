import { useRef, useState, type ReactNode } from 'react'
import { RefreshIcon } from './icons'

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void
  children: ReactNode
}

/** Touch-only pull-to-refresh that leaves normal scroll behavior untouched. */
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
    setDistance(Math.min(delta * 0.52, 96))
  }

  const onTouchEnd = () => {
    if (startY.current === null) return
    const shouldRefresh = distance >= threshold
    startY.current = null
    setDistance(0)
    if (!shouldRefresh || refreshing) return
    setRefreshing(true)
    Promise.resolve(onRefresh()).finally(() => window.setTimeout(() => setRefreshing(false), 340))
  }

  const active = refreshing || distance > 0
  return (
    <div className="pull-refresh" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {active && <div className={`pull-refresh__indicator${refreshing ? ' is-refreshing' : ''}`} style={{ opacity: Math.min(1, distance / threshold), transform: `translate(-50%, ${Math.min(distance, threshold)}px)` }}><RefreshIcon size={16} /><span>{refreshing ? 'Refreshing live feed…' : distance >= threshold ? 'Release to refresh' : 'Pull to refresh'}</span></div>}
      {children}
    </div>
  )
}
