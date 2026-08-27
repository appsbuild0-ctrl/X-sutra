// /api/channels — Telegram source channels (Vercel filesystem route).
import { handler as channels } from '../netlify/functions/channels.mjs'
import { runHandler } from '../netlify/functions/_server/vercel.mjs'

export default async function vercelChannels(req, res) {
  await runHandler(channels, req, res)
}
