import { useEffect, useState, type CSSProperties } from 'react'

interface CreatorAvatarProps {
  src?: string
  label: string
  index?: number
  className?: string
}

/** Never leave a broken-image icon in a real creator row. */
export function CreatorAvatar({ src, label, index = 0, className = 'creator-avatar' }: CreatorAvatarProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  const initial = (label.trim().slice(0, 1) || '?').toUpperCase()

  return (
    <span className={className} style={!src || failed ? { '--avatar-index': index } as CSSProperties : undefined}>
      {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : initial}
    </span>
  )
}
