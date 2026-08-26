import { json, safeError } from './_server/security.mjs'
import { assertOtpRateLimit } from './_server/database.mjs'
import { connectionStatus, sendOtp, telegramConfiguration, verifyOtp, verifyTwoFactor } from './_server/telegram.mjs'

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
    return json(400, { error: 'Unknown action.' })
  } catch (error) {
    // 429 passes its friendly message through; 503 names the missing variable.
    if (Number(error?.statusCode) === 429 || Number(error?.statusCode) === 503) return json(error.statusCode, { error: error.message })
    return safeError(error)
  }
}
