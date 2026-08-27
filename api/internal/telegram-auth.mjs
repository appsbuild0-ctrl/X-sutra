// /api/internal/telegram-auth — Vercel filesystem route.
// Plain Vercel Functions do not route multi-segment paths to the [...path]
// catch-all, so this dedicated function serves the nested endpoint directly.
// Handler stays shared with Netlify (netlify/functions/telegram-admin.mjs).
import { handler as telegramAdmin } from '../../netlify/functions/telegram-admin.mjs'
import { runHandler } from '../../netlify/functions/_server/vercel.mjs'

export default async function vercelTelegramAuth(req, res) {
  await runHandler(telegramAdmin, req, res)
}
