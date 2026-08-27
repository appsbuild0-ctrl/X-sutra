// /api/auth/telegram — "Login with Telegram" for X-Sutra.
//
// GET  → public widget configuration (bot @username only; never the token)
// POST → { action: 'login', auth: <widget payload> }  → verifies the Telegram
//        hash, creates/updates the account in PostgreSQL, returns a signed
//        X-Sutra JWT.
//
// The bot token lives only in TELEGRAM_BOT_TOKEN. No password, OTP, MTProto
// session, API_ID or API_HASH is requested, transmitted or stored.

import { errorResponse, json, signUserToken } from './_server/security.mjs'
import { telegramLoginConfiguration, verifyTelegramWidgetAuth } from './_server/telegramLogin.mjs'
import {
  addAdmin,
  listAdmins,
  listUsers,
  publicUser,
  removeAdmin,
  requireActiveUser,
  requireAdminUser,
  revokeUserSessions,
  setUserRole,
  setUserStatus,
  upsertTelegramUser
} from './_server/users.mjs'

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      // The @username is public information (it appears in the widget's own
      // URL), so the login screen can render the official button with it.
      return json(200, await telegramLoginConfiguration())
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

    const body = JSON.parse(event.body || '{}')
    const action = String(body.action || '')

    if (action === 'login') {
      // 1. prove the payload came from Telegram (HMAC over the bot token)
      const identity = verifyTelegramWidgetAuth(body.auth)
      // 2. only the verified id becomes the account — never a client value
      const user = await upsertTelegramUser(identity)
      if (!user) throw Object.assign(new Error('Could not create the X-Sutra account.'), { statusCode: 500 })
      if (user.status === 'off') throw Object.assign(new Error('This X-Sutra account is disabled.'), { statusCode: 403 })
      // 3. hand back a signed session; the role comes from the database
      const issued = await signUserToken(user)
      return json(200, { ok: true, user: publicUser(user), ...issued })
    }

    if (action === 'session') {
      const session = await requireActiveUser(event)
      return json(200, { ok: true, user: session.user })
    }

    if (action === 'logout') {
      // Server-side logout: JWTs issued before now stop working. A missing or
      // already-expired token is not an error — the device logs out anyway.
      const session = await requireActiveUser(event).catch(() => null)
      if (session) await revokeUserSessions(session.telegramId)
      return json(200, { ok: true })
    }

    // ---- admin-only: manage who is an admin, and account roles -------------
    if (action === 'listAdmins') {
      await requireAdminUser(event)
      return json(200, { admins: await listAdmins() })
    }
    if (action === 'addAdmin') {
      await requireAdminUser(event)
      return json(200, { admins: await addAdmin(body.telegramId, body.label) })
    }
    if (action === 'removeAdmin') {
      await requireAdminUser(event)
      return json(200, { admins: await removeAdmin(body.telegramId) })
    }
    if (action === 'listUsers') {
      await requireAdminUser(event)
      return json(200, { users: await listUsers() })
    }
    if (action === 'setUserRole') {
      await requireAdminUser(event)
      return json(200, { user: publicUser(await setUserRole(body.telegramId, body.role)) })
    }
    if (action === 'setUserStatus') {
      await requireAdminUser(event)
      return json(200, { user: publicUser(await setUserStatus(body.telegramId, body.status)) })
    }

    return json(400, { error: 'Unknown action.' })
  } catch (error) {
    return errorResponse(error)
  }
}
