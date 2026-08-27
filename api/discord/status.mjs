// /api/discord/status — Discord health check (Vercel filesystem route).
import { handler as discordMedia } from '../../netlify/functions/discord-media.mjs'
import { runHandler } from '../../netlify/functions/_server/vercel.mjs'

export default async function vercelDiscordStatus(req, res) {
  await runHandler(discordMedia, req, res)
}
