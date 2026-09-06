import { useEffect, useState } from 'react'

/**
 * Simulated presence counter for the Home card. It drifts gently around a
 * base number so the pill always looks alive. Purely presentational.
 */
export function useOnlineMembers(): number {
  const [online, setOnline] = useState(() => 2100 + Math.floor(Math.random() * 900))

  useEffect(() => {
    const timer = window.setInterval(() => {
      setOnline((current) => {
        const drift = Math.round((Math.random() - 0.5) * 160)
        const next = current + drift
        return Math.min(5400, Math.max(1150, next))
      })
    }, 3500)
    return () => window.clearInterval(timer)
  }, [])

  return online
}
