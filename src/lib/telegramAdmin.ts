// Owner-only client for the private Telegram source backend.
//
// Deliberately simple: there is NO setup-secret step. The UI only performs the
// Telegram OTP login; once it succeeds the backend returns a signed owner
// session token that is stored on the device (lib/telegramOwner.ts) so the
// console never asks for a login again. No secret is ever sent, stored, or
// bundled by this module.

import { clearOwnerSession, readOwnerSession, writeOwnerSession } from './telegramOwner'

const AUTH_ENDPOINT = '/api/internal/telegram-auth'

export interface TelegramConfiguration {
  configured: boolean
  missing: string[]
}

export interface TelegramConnection {
  connected: boolean
  status: string
  telegramUserId?: string
  authorizedAt?: string | null
}

/** Every response can carry a freshly issued owner session token. */
export interface OwnerIssued {
  ownerToken?: string
  expiresAt?: string
}

export interface TelegramAuthStatus extends OwnerIssued {
  configuration: TelegramConfiguration
  connection: TelegramConnection
}

export interface TelegramOtpSent extends OwnerIssued {
  ok: true
  status: 'otp_sent' | 'already_authorized'
  delivery?: string
}

export interface TelegramAuthorized extends OwnerIssued {
  ok: true
  status: 'authorized'
}

export interface TelegramTwoFactorRequired {
  ok: true
  status: '2fa_required'
}

export class TelegramAdminError extends Error {}

export function ownerSessionActive(): boolean {
  return Boolean(readOwnerSession()?.token)
}

export function endOwnerSession(): void {
  clearOwnerSession()
}

async function request<T extends object>(body?: Record<string, unknown>, fresh = false): Promise<T> {
  const owner = readOwnerSession()
  let response: Response
  try {
    response = await fetch(fresh ? `${AUTH_ENDPOINT}?refresh=1` : AUTH_ENDPOINT, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(owner?.token ? { authorization: `Bearer ${owner.token}` } : {})
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
  // Persist the one-time login so this device never logs in again.
  const issued = data as OwnerIssued
  if (issued?.ownerToken) writeOwnerSession(issued.ownerToken, issued.expiresAt)
  return data as T
}

export function fetchTelegramStatus(fresh = false): Promise<TelegramAuthStatus> {
  return request<TelegramAuthStatus>(undefined, fresh)
}

export function sendTelegramOtp(phone = ''): Promise<TelegramOtpSent> {
  return request<TelegramOtpSent>(phone ? { action: 'send_otp', phone } : { action: 'send_otp' })
}

export function verifyTelegramOtp(code: string): Promise<TelegramAuthorized | TelegramTwoFactorRequired> {
  return request<TelegramAuthorized | TelegramTwoFactorRequired>({ action: 'verify_otp', code })
}

export function verifyTelegramTwoFactor(password: string): Promise<TelegramAuthorized> {
  return request<TelegramAuthorized>({ action: 'verify_2fa', password })
}
