/**
 * DiscordServerWidget — live embed of the X-Sutra Discord server.
 *
 * This is the official Discord server widget: it shows the real channels and
 * online members of the "x-sutra" server (id 1542540297005834242) — no login,
 * no bot, no sync. Channels show by themselves, live.
 *
 * One-time step on the owner's side (Discord app):
 *   x-sutra server → Settings → Widget → toggle ON.
 * Until the widget is enabled the frame shows Discord's "widget disabled"
 * placeholder, so the UI stays honest instead of faking channels.
 */

import { DiscordLogo } from './DiscordLoginCard'

const DISCORD_WIDGET_URL = 'https://discord.com/widget?id=1542540297005834242&theme=dark'

export function DiscordServerWidget(): React.JSX.Element {
  return (
    <div className="discord-widget">
      <div className="discord-widget__head">
        <DiscordLogo size={14} />
        <strong>x-sutra · Discord server</strong>
        <small>live channels</small>
      </div>
      <iframe
        src={DISCORD_WIDGET_URL}
        title="x-sutra Discord server"
        className="discord-widget__frame"
        allowTransparency
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
      />
    </div>
  )
}
