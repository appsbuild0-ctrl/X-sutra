import { json, requireOwner, safeError } from './_server/security.mjs'
import { assertOtpRateLimit } from './_server/database.mjs'
import { connectionStatus, sendOtp, syncChannels, telegramConfiguration, verifyOtp, verifyTwoFactor } from './_server/telegram.mjs'

// Simple owner login: no setup secret in the UI. The OTP goes only to the
// phone configured as TELEGRAM_PHONE, only ADMIN_TELEGRAM_USER_ID can finish,
// and code requests are rate-limited per caller. A successful login returns a
// long-lived owner token so the device never logs in again.
const callerIp = (event) =>
  String(event.headers?.['x-forwarded-for'] || event.headers?.['x-nf-client-ip'] || event.headers?.['x-real-ip'] || 'unknown').split(',')[0].trim() || 'unknown'

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      return json(200, { configuration: telegramConfiguration(), connection: await connectionStatus() })
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })
    const body = JSON.parse(event.body || '{}')
    if (body.action === 'send_otp') {
      await assertOtpRateLimit(callerIp(event))
      return json(200, await sendOtp(body.phone))
    }
    if (body.action === 'verify_otp') {
      if (!/^\d{4,8}$/.test(String(body.code || ''))) return json(400, { error: 'A valid OTP is required.' })
      return json(200, await verifyOtp(body.code))
    }
    if (body.action === 'verify_2fa') {
      if (!body.password) return json(400, { error: 'Telegram 2FA password is required.' })
      return json(200, await verifyTwoFactor(body.password))
    }
    // Owner-only: imports the owner's Telegram channels into xs_channels so the
    // Premium "Telegram sources" list has something to show.
    if (body.action === 'sync_channels') {
      await requireOwner(event)
      return json(200, await syncChannels())
    }
    return json(400, { error: 'Unknown action.' })
  } catch (error) {
    const status = Number(error?.statusCode)
    // Friendly/rate-limit and config errors pass through verbatim.
    if (status === 429 || status === 503) return json(status, { error: error.message })
    // For any other server error, surface the real message on this owner-only
    // endpoint so a bad DATABASE_URL / connection problem is actionable instead
    // of a generic "Backend operation failed."
    if (status >= 500 || !status) return json(500, { error: `Backend: ${error?.message || 'operation failed.'}` })
    return safeError(error)
  }
}
