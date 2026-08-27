// /api/telegram/channels — Vercel filesystem route.
// Plain Vercel Functions do not route multi-segment paths to the [...path]
// catch-all, so this dedicated function serves the nested endpoint directly.
// Handler stays shared with Netlify (netlify/functions/telegram-channels.mjs).
import { handler as telegramChannels } from '../../netlify/functions/telegram-channels.mjs'
import { runHandler } from '../../netlify/functions/_server/vercel.mjs'

export default async function vercelTelegramChannels(req, res) {
  await runHandler(telegramChannels, req, res)
}
