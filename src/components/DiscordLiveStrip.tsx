import { useNavigate } from 'react-router-dom'
import { useDiscordFeed } from '../lib/discordFeed'
import { UNCROPPED_IMAGE_STYLE } from '../lib/imageFit'
import { useApp } from '../context/AppContext'

/**
 * "Live from Discord" strip on the Premium home.
 *
 * Opening it is what makes the whole flow feel live: the feed request also
 * triggers the server-side auto-sync, so media posted to a mapped Discord
 * channel a moment ago is already here — no upload, no manual refresh.
 */
export function DiscordLiveStrip(): React.JSX.Element | null {
  const navigate = useNavigate()
  const { account } = useApp()
  const feed = useDiscordFeed({ pageSize: 12 })
  const isAdmin = account?.role === 'admin'

  // Nothing configured and nothing to show: stay out of the way.
  if (!feed.configured && !feed.items.length) {
    if (!isAdmin) return null
    return (
      <div className="discord-live discord-live--empty">
        <strong>Discord connected nahi hai</strong>
        <small>Server pe DISCORD_BOT_TOKEN + DISCORD_GUILD_ID set karo, phir Admin → Discord me channel map karo.</small>
      </div>
    )
  }

  if (!feed.items.length) {
    return (
      <div className="discord-live discord-live--empty">
        <strong>{feed.refreshing ? 'Discord check ho raha hai…' : 'Discord se media aane wala hai'}</strong>
        <small>Mapped Discord channel me image/video forward karo — wo yahan apne aap aa jayega.</small>
      </div>
    )
  }

  return (
    <div className="discord-live">
      <button type="button" className="discord-live__head" onClick={() => navigate('/premium/library')}>
        <span>
          <strong>Live from Discord</strong>
          <small>{feed.refreshing ? 'checking…' : `${feed.items.length} latest · tap for all`}</small>
        </span>
        <span className="discord-live__cta">Open ›</span>
      </button>
      <div className="discord-live__row">
        {feed.items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="discord-live__tile"
            onClick={() => navigate('/premium/library')}
            aria-label={item.title}
          >
            {item.type === 'image'
              ? <img src={item.thumbnail || item.url} alt="" loading="lazy" decoding="async" style={UNCROPPED_IMAGE_STYLE} />
              // No fake poster: the real first frame of the real file.
              : <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" style={UNCROPPED_IMAGE_STYLE} />}
            {item.type === 'video' && <span className="discord-live__play" aria-hidden="true">▶</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
