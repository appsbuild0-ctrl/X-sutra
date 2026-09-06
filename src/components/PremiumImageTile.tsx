import { useState } from 'react'
import { UNCROPPED_IMAGE_STYLE } from '../lib/imageFit'

/**
 * A premium image tile.
 *
 * - Original aspect ratio and resolution: the frame is sized from the media's
 *   real pixel size and the image is fitted inside it — never cropped.
 * - Lazy-loaded, so a long library stays fast.
 * - Resilient: if a Discord CDN signature has expired the load fails once, the
 *   same-origin resolver is asked again (it re-reads the message and returns a
 *   fresh link), and only then does the tile show a fallback instead of a
 *   broken image.
 */
export function PremiumImageTile({ url, title, width, height, onOpen }: {
  url: string
  title: string
  width?: number
  height?: number
  onOpen?: () => void
}): React.JSX.Element {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const src = attempt ? `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}` : url

  const image = failed ? (
    <span className="premium-image__broken">
      <strong>Preview unavailable</strong>
      <small>Tap to open the original</small>
    </span>
  ) : (
    <img
      src={src}
      alt={title}
      loading="lazy"
      decoding="async"
      width={width || undefined}
      height={height || undefined}
      style={UNCROPPED_IMAGE_STYLE}
      onError={() => { if (attempt < 1) setAttempt(attempt + 1); else setFailed(true) }}
    />
  )

  if (!onOpen) {
    return <a className="premium-image" href={url} target="_blank" rel="noreferrer">{image}</a>
  }
  return (
    <button type="button" className="premium-image premium-image--button" onClick={onOpen} aria-label={title}>
      {image}
    </button>
  )
}
