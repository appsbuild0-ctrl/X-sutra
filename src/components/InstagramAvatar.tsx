import { useEffect, useState } from 'react'

interface InstagramAvatarProps {
  src?: string
  label?: string
  size?: number
  className?: string
}

/** Instagram-style circular avatar with fallback initials */
export function InstagramAvatar({ src, label, size = 32, className }: InstagramAvatarProps): JSX.Element {
  const [failed, setFailed] = useState(false)
  const initial = (label?.trim().slice(0, 1) || '?').toUpperCase()

  useEffect(() => setFailed(false), [src])

  return (
    <span
      className={`instagram-avatar${className ? ` ${className}` : ''}`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2, // Circular
        overflow: 'hidden',
        position: 'relative'
      }}
      onError={() => setFailed(true)}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={label || ''}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }}
        />
      ) : (
        <span
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#eee',
            color: '#555',
            fontWeight: 'bold',
            fontSize: Math.max(1, size * 0.4),
            lineHeight: 1
          }}
        >
          {initial}
        </span>
      )}
    </span>
  )
}