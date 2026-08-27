import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  fetchDiscordHealth,
  DiscordAdminError,
  type DiscordHealthStatus
} from '../lib/discordAdmin'

type Stage = 'loading' | 'ready' | 'connected'

function StatusBadge({ ok, children }: { ok: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <span
      className="online-pill"
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: ok ? '#7ef0c2' : '#ffb4a2',
        background: ok ? 'rgba(46, 204, 113, .14)' : 'rgba(255, 99, 71, .14)'
      }}
    >
      {children}
    </span>
  )
}

/**
 * Discord admin card: shows bot connection health, guild/channel status, and
 * admin user configuration. Bot token is NEVER displayed.
 */
export function DiscordAdminCard({ onChanged }: { onChanged?: () => void }): React.JSX.Element {
  const { notify } = useApp()
  const changed = () => { onChanged?.() }
  const [stage, setStage] = useState<Stage>('loading')
  const [status, setStatus] = useState<DiscordHealthStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const booted = useRef(false)

  const run = async (job: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await job()
    } catch (caught) {
      setError(caught instanceof DiscordAdminError ? caught.message : 'Discord operation failed.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void run(async () => {
      const result = await fetchDiscordHealth()
      setStatus(result)
      setStage(result.overall === 'ok' ? 'connected' : 'ready')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = () => void run(async () => {
    const result = await fetchDiscordHealth()
    setStatus(result)
    setStage(result.overall === 'ok' ? 'connected' : 'ready')
    changed()
  })

  if (stage === 'loading') {
    return (
      <div className="settings-card">
        <p className="form-help" style={{ margin: 0 }}>{busy ? 'Checking Discord connection…' : 'Connecting to Discord…'}</p>
        {error && <p className="login-error" role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <>
      <div className="settings-card">
        <div className="setting-row">
          <span><strong>Discord Bot</strong></span>
          {status ? (
            <StatusBadge ok={status.overall === 'ok'}>
              {status.overall === 'ok' ? 'Connected' : 'Not connected'}
            </StatusBadge>
          ) : <small>Checking…</small>}
        </div>

        {status?.botUser && (
          <div className="setting-row">
            <span><strong>Bot User</strong></span>
            <small>@{status.botUser.username}</small>
          </div>
        )}

        <div className="setting-row">
          <span><strong>Server (Guild)</strong></span>
          {status?.guild ? (
            <StatusBadge ok={status.guild.found}>
              {status.guild.found ? status.guild.name : 'Not found'}
            </StatusBadge>
          ) : <small>—</small>}
        </div>

        <div className="setting-row">
          <span><strong>Channel</strong></span>
          {status?.channel ? (
            <StatusBadge ok={status.channel.found}>
              {status.channel.found ? `#${status.channel.name}` : 'Not found'}
            </StatusBadge>
          ) : <small>—</small>}
        </div>

        {status?.channel?.found && (
          <>
            <div className="setting-row">
              <span><strong>Can Send Messages</strong></span>
              <StatusBadge ok={status.channel.canSend}>{status.channel.canSend ? 'Yes' : 'No'}</StatusBadge>
            </div>
            <div className="setting-row">
              <span><strong>Can Attach Files</strong></span>
              <StatusBadge ok={status.channel.canAttach}>{status.channel.canAttach ? 'Yes' : 'No'}</StatusBadge>
            </div>
          </>
        )}

        <div className="setting-row">
          <span><strong>Admin User ID</strong></span>
          {status?.adminUser?.configured ? (
            <small>{status.adminUser.userId}</small>
          ) : (
            <StatusBadge ok={false}>Not configured</StatusBadge>
          )}
        </div>

        {status?.error && (
          <p className="login-error" role="alert">{status.error}</p>
        )}

        <div className="home-header-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={refresh}>
            {busy ? 'Checking…' : 'Refresh'}
          </button>
        </div>
      </div>

      {status?.overall === 'ok' && (
        <div className="settings-card">
          <div className="setting-row">
            <span><strong>Bot Token</strong></span>
            <StatusBadge ok={true}>Configured (hidden)</StatusBadge>
          </div>
          <p className="form-help">
            ✅ Discord bot is connected and verified. Uploads and deletions go through the
            configured channel. Bot token is stored server-side only and is never exposed.
          </p>
        </div>
      )}

      {status?.overall !== 'ok' && (
        <div className="settings-card">
          <p className="form-help">
            ⚠️ Discord bot is not connected. Configure these environment variables on your
            hosting provider and redeploy:
          </p>
          <ul className="form-help" style={{ margin: '8px 0', paddingLeft: 20 }}>
            <li><code>DISCORD_BOT_TOKEN</code> — Your bot token from Discord Developer Portal</li>
            <li><code>DISCORD_GUILD_ID</code> — Your Discord server ID</li>
            <li><code>DISCORD_CHANNEL_ID</code> — Target channel ID for uploads</li>
            <li><code>DISCORD_ADMIN_USER_ID</code> — Your Discord user ID for admin operations</li>
          </ul>
          <p className="form-help">
            Required bot permissions: View Channel, Send Messages, Read Message History,
            Attach Files, Embed Links, Manage Messages (for deletion).
          </p>
        </div>
      )}
    </>
  )
}
