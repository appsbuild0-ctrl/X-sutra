import { json, requireOwner, safeError, signOwnerToken } from './_server/security.mjs'
import { connectionStatus, sendOtp, telegramConfiguration, verifyOtp, verifyTwoFactor } from './_server/telegram.mjs'

export const handler = async (event) => {
  try {
    // Owner gate: the bootstrap secret works once, an issued owner session
    // token keeps the console unlocked on every later visit (no new login).
    const owner = await requireOwner(event)
    if (event.httpMethod === 'GET') {
      const fresh = event.queryStringParameters?.refresh === '1' || event.queryStringParameters?.fresh === '1'
      const connection = await connectionStatus({ fresh })
      const body = { configuration: telegramConfiguration(), connection }
      // First unlock with the bootstrap secret also receives the long-lived
      // owner token, so the secret is never needed again on this device.
      if (owner.via === 'secret' && connection.connected) Object.assign(body, await signOwnerToken(connection.telegramUserId))
      return json(200, body)
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })
    const body = JSON.parse(event.body || '{}')
    if (body.action === 'send_otp') return json(200, await sendOtp(body.phone))
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
    // 503 means the server environment is incomplete. Name the missing
    // variables for the owner (names only, never values) so the console is
    // actionable instead of showing a generic failure.
    if (Number(error?.statusCode) === 503) return json(503, { error: error.message })
    return safeError(error)
  }
}
