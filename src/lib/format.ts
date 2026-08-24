export function compactNumber(value?: number): string {
  if (!value) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

export function durationLabel(seconds?: number): string {
  if (!seconds || seconds < 1) return 'clip'
  const rounded = Math.round(seconds)
  const minutes = Math.floor(rounded / 60)
  const remainder = String(rounded % 60).padStart(2, '0')
  return minutes ? `${minutes}:${remainder}` : `0:${remainder}`
}

export function relativeDate(isoDate: string): string {
  const time = new Date(isoDate).getTime()
  if (Number.isNaN(time)) return ''
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function formatBytes(bytes?: number): string {
  const value = Number(bytes)
  if (!value || value < 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}
