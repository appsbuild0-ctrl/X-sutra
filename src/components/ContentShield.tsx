import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export function ContentShield(): null {
  const { pathname } = useLocation()
  const allow = pathname.startsWith('/admin') || pathname.startsWith('/login') || pathname.startsWith('/settings')

  useEffect(() => {
    if (allow) return
    const block = (event: Event) => event.preventDefault()
    document.addEventListener('contextmenu', block)
    document.addEventListener('copy', block)
    document.addEventListener('cut', block)
    document.addEventListener('dragstart', block)
    return () => {
      document.removeEventListener('contextmenu', block)
      document.removeEventListener('copy', block)
      document.removeEventListener('cut', block)
      document.removeEventListener('dragstart', block)
    }
  }, [allow])
  return null
}
