// Owner-only client for the private Telegram source backend.
// The admin setup secret is supplied per call and lives in component memory
// only — it is never written to localStorage, sessionStorage, or any cached
// store, and it never ships inside the bundle.

const AUTH_ENDPOINT = '/api/internal/telegram-auth'

export interface TelegramConfiguration {
  configured: boolean
  missing: string[]
}

export interface TelegramConnection {
  connected: boolean
  status: string
}

export interface TelegramAuthStatus {
  configuration: TelegramConfiguration
  connection: TelegramConnection
}

export interface TelegramOtpSent {
  ok: true
  status: 'otp_sent'
  delivery: string
}

export interface TelegramAuthorized {
  ok: true
  status: 'authorized'
}

export interface TelegramTwoFactorRequired {
  ok: true
  status: '2fa_required'
}

export class TelegramAdminError extends Error {}

async function request<T>(secret: string, body?: Record<string, unknown>): Promise<T> {
  let response: Response
  try {
    response = await fetch(AUTH_ENDPOINT, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        'x-admin-setup-secret': secret
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    })
  } catch {
    throw new TelegramAdminError('Telegram backend is unreachable.')
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new TelegramAdminError(typeof data.error === 'string' ? data.error : 'Telegram backend request failed.')
  }
  return data as T
}

export function fetchTelegramStatus(secret: string): Promise<TelegramAuthStatus> {
  return request<TelegramAuthStatus>(secret)
}

export function sendTelegramOtp(secret: string, phone: string): Promise<TelegramOtpSent> {
  return request<TelegramOtpSent>(secret, { action: 'send_otp', phone })
}

export function verifyTelegramOtp(secret: string, code: string): Promise<TelegramAuthorized | TelegramTwoFactorRequired> {
  return request<TelegramAuthorized | TelegramTwoFactorRequired>(secret, { action: 'verify_otp', code })
}

export function verifyTelegramTwoFactor(secret: string, password: string): Promise<TelegramAuthorized> {
  return request<TelegramAuthorized>(secret, { action: 'verify_2fa', password })
}
