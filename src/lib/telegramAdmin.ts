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
  /** Masked owner phone from TELEGRAM_PHONE, e.g. "+91••••••21" — shown so the
   *  owner knows where the code goes. The full number is never sent. */
  phoneHint?: string
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
  phoneHint?: string
}

export interface TelegramAuthorized extends OwnerIssued {
  ok: true
  status: 'authorized'
}

export interface TelegramTwoFactorRequired {
  ok: true
  status: '2fa_required'
}

export class TelegramAdminError extends Error {
  /** Telegram RPC error code when the backend reported one (PHONE_CODE_INVALID…). */
  readonly telegramError?: string

  constructor(message: string, telegramError?: string) {
    super(message)
    this.name = 'TelegramAdminError'
    this.telegramError = telegramError
  }
}

export function ownerSessionActive(): boolean {
  return Boolean(readOwnerSession()?.token)
}

export function endOwnerSession(): void {
  clearOwnerSession()
}

/**
 * Turns a failed response into the exact backend message. A generic
 * "Telegram authorization failed." hides whether the code was wrong, expired,
 * rate-limited, or the database was unreachable — so the real detail (JSON
 * `error`, else the raw body, else the HTTP status) is always kept.
 */
function describeFailure(status: number, data: Record<string, unknown>, raw: string): string {
  const message = typeof data.error === 'string' ? data.error.trim() : ''
  if (message) return message
  const snippet = raw.trim().replace(/\s+/g, ' ').slice(0, 240)
  return snippet ? `Backend error (HTTP ${status}): ${snippet}` : `Backend error (HTTP ${status}) with no message.`
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
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : 'network error'
    throw new TelegramAdminError(`Telegram backend is unreachable (${detail}).`)
  }
  const raw = await response.text()
  let data: Record<string, unknown> = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
  } catch {
    // Non-JSON body (proxy/HTML error page) — the raw text is shown instead.
  }
  if (!response.ok) {
    const telegramError = typeof data.telegramError === 'string' ? data.telegramError : undefined
    throw new TelegramAdminError(describeFailure(response.status, data, raw), telegramError)
  }
  // Persist the one-time login so this device never logs in again.
  const issued = data as OwnerIssued
  if (issued?.ownerToken) writeOwnerSession(issued.ownerToken, issued.expiresAt)
  return data as T
}

export interface TelegramChannelRow {
  id: string
  title: string
  avatar?: string | null
  category: string
  access_role: string
  media_count: number
  latest_at?: string | null
}

export interface TelegramSyncResult extends OwnerIssued {
  ok: true
  status: 'synced'
  /** Dialogs scanned on Telegram. */
  scanned: number
  /** Channels/supergroups found in those dialogs. */
  channels: number
  /** Rows written to xs_channels. */
  saved: number
}

/** Lists the connected Telegram source channels using the saved owner token. */
export async function fetchTelegramChannels(): Promise<TelegramChannelRow[]> {
  const owner = readOwnerSession()
  try {
    const response = await fetch('/api/telegram/channels', {
      headers: owner?.token ? { authorization: `Bearer ${owner.token}` } : {},
      cache: 'no-store'
    })
    if (!response.ok) return []
    const data = (await response.json().catch(() => ({}))) as { channels?: TelegramChannelRow[] }
    return Array.isArray(data.channels) ? data.channels : []
  } catch {
    return []
  }
}

export function fetchTelegramStatus(fresh = false): Promise<TelegramAuthStatus> {
  return request<TelegramAuthStatus>(undefined, fresh)
}

/**
 * Asks the backend to send a login code. The phone number is NOT sent: the
 * server always uses TELEGRAM_PHONE from its own environment, so the only
 * thing the owner ever types is the OTP.
 */
export function sendTelegramOtp(): Promise<TelegramOtpSent> {
  return request<TelegramOtpSent>({ action: 'send_otp' })
}

export function verifyTelegramOtp(code: string): Promise<TelegramAuthorized | TelegramTwoFactorRequired> {
  return request<TelegramAuthorized | TelegramTwoFactorRequired>({ action: 'verify_otp', code })
}

export function verifyTelegramTwoFactor(password: string): Promise<TelegramAuthorized> {
  return request<TelegramAuthorized>({ action: 'verify_2fa', password })
}

/**
 * Imports the owner's Telegram channels into the backend (xs_channels) so the
 * Premium "Telegram sources" list is populated. Owner token required.
 */
export function syncTelegramChannels(): Promise<TelegramSyncResult> {
  return request<TelegramSyncResult>({ action: 'sync_channels' })
}
