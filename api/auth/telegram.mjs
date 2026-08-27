// /api/auth/telegram — "Login with Telegram" (Vercel filesystem route).
// Multi-segment paths need their own file because plain Vercel Functions do not
// route them to the [...path] catch-all. Handler shared with Netlify.
import { handler as authTelegram } from '../../netlify/functions/auth-telegram.mjs'
import { runHandler } from '../../netlify/functions/_server/vercel.mjs'

export default async function vercelAuthTelegram(req, res) {
  await runHandler(authTelegram, req, res)
}
