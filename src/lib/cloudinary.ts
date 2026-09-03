/**
 * Cloudinary upload — unsigned client-side uploads.
 *
 * Requires these env vars (set in Vite env or .env):
 *   VITE_CLOUDINARY_CLOUD_NAME  — your Cloudinary cloud name
 *   VITE_CLOUDINARY_UPLOAD_PRESET — unsigned upload preset name
 *
 * Create an unsigned upload preset in Cloudinary Dashboard → Settings → Upload.
 */

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined

export interface CloudinaryResult {
  secure_url: string
  public_id: string
  width: number
  height: number
  bytes: number
  format: string
  resource_type: string
  created_at: string
}

/**
 * Upload a file to Cloudinary using unsigned upload.
 * Returns the Cloudinary response with the permanent secure URL.
 */
export async function uploadToCloudinary(
  file: File,
  folder?: string,
  onProgress?: (pct: number) => void,
): Promise<CloudinaryResult> {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error(
      'Cloudinary not configured. Set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET in your .env file.',
    )
  }

  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', UPLOAD_PRESET)
  if (folder) formData.append('folder', folder)

  // Use XHR for progress tracking
  return new Promise<CloudinaryResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText)
        if (xhr.status >= 200 && xhr.status < 300 && data.secure_url) {
          resolve(data as CloudinaryResult)
        } else {
          reject(new Error(data.error?.message || `Cloudinary upload failed (${xhr.status})`))
        }
      } catch {
        reject(new Error('Failed to parse Cloudinary response'))
      }
    }

    xhr.onerror = () => reject(new Error('Network error — Cloudinary upload failed'))
    xhr.ontimeout = () => reject(new Error('Cloudinary upload timed out'))
    xhr.timeout = 120_000 // 2 min

    xhr.send(formData)
  })
}

/**
 * Check if Cloudinary is configured.
 */
export function isCloudinaryConfigured(): boolean {
  return Boolean(CLOUD_NAME && UPLOAD_PRESET)
}

/**
 * Get the Cloudinary cloud name for display/debug.
 */
export function getCloudName(): string {
  return CLOUD_NAME || '(not configured)'
}
