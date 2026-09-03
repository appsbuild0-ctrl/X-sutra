import { readStored, removeStored, writeStored } from './storage'

const QR_KEY = 'x-sutra.pay.qr.v1'

export function readPayQr(): string {
  return readStored<string>(QR_KEY, '')
}

export function writePayQr(dataUrl: string): void {
  writeStored(QR_KEY, dataUrl)
}

export function clearPayQr(): void {
  removeStored(QR_KEY)
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not read QR image'))
    reader.readAsDataURL(file)
  })
}
