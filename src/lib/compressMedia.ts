/**
 * compressMedia — Shrinks images via canvas before converting to base64 data-URL
 * so they survive localStorage (~5 MB quota).
 *
 * Images are resized to a max dimension and JPEG-compressed at 0.7 quality.
 * Videos are passed through as-is (too expensive to transcode client-side).
 */

const MAX_DIMENSION = 600   // px — smaller for localStorage persistence
const JPEG_QUALITY  = 0.6

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image for compression'))
    img.src = src
  })
}

/**
 * Accepts a File, returns a base64 data-URL string.
 * Images are compressed; other types are read as-is.
 */
export function compressToFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    // Videos and other files — read as-is (can't easily compress video client-side)
    return readAsDataURL(file)
  }
  return compressImage(file)
}

async function compressImage(file: File): Promise<string> {
  const originalUrl = readAsDataURL(file)
  const dataUrl = await originalUrl
  const img = await loadImage(dataUrl)

  let { width, height } = img
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
    width  = Math.round(width  * ratio)
    height = Math.round(height * ratio)
  }

  const canvas = document.createElement('canvas')
  canvas.width  = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, width, height)

  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
