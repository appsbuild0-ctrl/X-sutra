/**
 * /api/discord/cron — scheduled background sync (Netlify scheduled function).
 *
 * This is the fallback behind the read-time auto-sync: even when nobody has the
 * app open, mapped channels are re-read on a schedule so forwarded media is
 * already waiting in Premium. Configure the interval in netlify.toml
 * (`[functions."discord-cron"] schedule = "…"`); it is a no-op when auto-sync is
 * off or no channel is mapped.
 */

import { defaultDiscordConfig, readCatalog, writeCatalog } from './_premium-store.mjs'
import { importChannels } from './_server/discord.mjs'
import { dueChannels } from './discord-feed.mjs'
import { applySyncResult } from './discord-sync.mjs'

export const handler = async () => {
  try {
    if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'not_configured' }) }
    }
    const catalog = await readCatalog()
    const config = { ...defaultDiscordConfig(), ...(catalog.discord || {}) }
    if (!config.autoSync || !config.mappings.length) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: config.autoSync ? 'no_mappings' : 'auto_sync_off' }) }
    }

    const due = dueChannels(config)
    if (!due.length) return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'nothing_due' }) }

    const summary = await importChannels({
      channelIds: due,
      perChannel: config.perChannel,
      kinds: config.kinds,
      mode: config.mode,
      mappings: config.mappings,
      cursors: config.cursors,
      incremental: true
    })
    const fresh = await readCatalog()
    await writeCatalog({ ...fresh, discord: applySyncResult(fresh, summary) })
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, channels: due.length, scanned: summary.scanned, imported: summary.imported, skipped: summary.skipped, failed: summary.failed, partial: summary.partial })
    }
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Scheduled Discord sync failed.' }) }
  }
}
