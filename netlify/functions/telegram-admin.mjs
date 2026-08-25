import { requireBootstrap, safeError, json } from './_server/security.mjs'
import { connectionStatus, sendOtp, verifyOtp, verifyTwoFactor } from './_server/telegram.mjs'

export const handler = async (event) => {
  try {
    requireBootstrap(event)
    if (event.httpMethod === 'GET') return json(200, await connectionStatus())
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })
    const body = JSON.parse(event.body || '{}')
    if (body.action === 'send_otp') return json(200, await sendOtp())
    if (body.action === 'verify_otp') {
      if (!/^\d{4,8}$/.test(String(body.code || ''))) return json(400, { error: 'A valid OTP is required.' })
      return json(200, await verifyOtp(body.code))
    }
    if (body.action === 'verify_2fa') {
      if (!body.password) return json(400, { error: 'Telegram 2FA password is required.' })
      return json(200, await verifyTwoFactor(body.password))
    }
    return json(400, { error: 'Unknown action.' })
  } catch (error) { return safeError(error) }
}
