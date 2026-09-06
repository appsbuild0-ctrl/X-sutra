import type { MediaItem } from '../types'

/**
 * Uncropped image display.
 *
 * Premium/Discord media is user content with real pixel dimensions, so it is
 * rendered at its own aspect ratio instead of being forced into a fixed frame
 * and clipped. These helpers are the single source of truth for that, and are
 * covered by scripts/tests/image-fit.test.mjs.
 */

/** Intrinsic aspect ratio (w/h), or null when the size is unknown/invalid. */
export function aspectOf(width?: number | null, height?: number | null): number | null {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return w / h
}

/**
 * Frame style for a media tile. With a known size the frame takes the media's
 * own ratio; without one no ratio is forced, so the browser lays the element out
 * from the loaded image instead of a guessed box.
 */
export function naturalFrameStyle(width?: number | null, height?: number | null): Record<string, string> {
  const ratio = aspectOf(width, height)
  return ratio ? { aspectRatio: `${Number(width)} / ${Number(height)}` } : {}
}

/** Image element style: full width, natural height, never cropped. */
export const UNCROPPED_IMAGE_STYLE: Record<string, string> = {
  display: 'block',
  width: '100%',
  height: 'auto',
  objectFit: 'contain'
}

/**
 * Should this item be shown uncropped? Videos keep the uniform reel frame,
 * imported/uploaded images do not.
 */
export function isUncroppedImage(item: Pick<MediaItem, 'videoUrl' | 'previewUrl'> & { type?: string }): boolean {
  if (item.type === 'image') return true
  if (item.type === 'video') return false
  const source = item.videoUrl || item.previewUrl || ''
  return !/\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(source)
}
