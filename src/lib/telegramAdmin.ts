// Owner-only client for the private Telegram source backend.
//
// Two credentials exist and they never mix:
//  • the ADMIN_SETUP_SECRET — typed once, kept in component memory only, never
//    written to localStorage/sessionStorage or bundled into the app;
//  • the signed owner session token — issued by the backend after the one-time
//    Telegram login and stored on the device by lib/telegramOwner.ts, so the
//    console reopens by itself and never asks for a login again.

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

async function request<T extends object>(secret: string, body?: Record<string, unknown>, fresh = false): Promise<T> {
  // A typed secret always wins: it is the trusted first-login path and must
  // still work when a stale token is sitting in device storage.
  const owner = secret ? null : readOwnerSession()
  let response: Response
  try {
    response = await fetch(fresh ? `${AUTH_ENDPOINT}?refresh=1` : AUTH_ENDPOINT, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(secret ? { 'x-admin-setup-secret': secret } : {}),
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
    const message = typeof data.error === 'string' ? data.error : 'Telegram backend request failed.'
    if (response.status === 401 && owner) {
      clearOwnerSession()
      throw new TelegramAdminError('Owner session expired. Unlock the console once more.')
    }
    throw new TelegramAdminError(message)
  }
  // Persist the one-time login so this device never logs in again.
  const issued = data as OwnerIssued
  if (issued?.ownerToken) writeOwnerSession(issued.ownerToken, issued.expiresAt)
  return data as T
}

export function fetchTelegramStatus(secret = '', fresh = false): Promise<TelegramAuthStatus> {
  return request<TelegramAuthStatus>(secret, undefined, fresh)
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
