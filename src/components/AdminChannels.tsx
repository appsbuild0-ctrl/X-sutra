import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  createChannel,
  deleteChannel,
  fetchAdminChannels,
  TelegramLoginError,
  updateChannel,
  type ChannelRecord
} from '../lib/telegramLogin'

const ACCESS_LABELS: Array<[ChannelRecord['accessRole'], string]> = [
  ['public', '🌐 Everyone'],
  ['premium', '⭐ Premium + VIP'],
  ['vip', '💎 VIP only'],
  ['admin', '👑 Admins only']
]

/**
 * Telegram source channels. The owner's channel (-1004400682253) is seeded on
 * the server automatically, so this list is never empty. Admins create, rename,
 * hide and delete the rest. All writes are authorised against the database.
 */
export function AdminChannels(): React.JSX.Element {
  const { notify } = useApp()
  const [channels, setChannels] = useState<ChannelRecord[]>([])
  const [newId, setNewId] = useState('-1004400682253')
  const [newTitle, setNewTitle] = useState('')
  const [newCategory, setNewCategory] = useState('channel')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setChannels(await fetchAdminChannels())
    } catch (caught) {
      setError(caught instanceof TelegramLoginError ? caught.message : 'Channels could not load.')
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const add = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setChannels(await createChannel({ id: newId.trim(), title: newTitle.trim(), category: newCategory.trim() }))
      notify(`Channel ${newId.trim()} added`, 'success')
      setNewTitle('')
    } catch (caught) {
      setError(caught instanceof TelegramLoginError ? caught.message : 'Channel could not be added.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (channel: ChannelRecord): Promise<void> => {
    if (!window.confirm(`Delete channel "${channel.title}" (${channel.id})?`)) return
    try {
      await deleteChannel(channel.id)
      notify('Channel deleted', 'success')
      await reload()
    } catch (caught) {
      setError(caught instanceof TelegramLoginError ? caught.message : 'Channel could not be deleted.')
    }
  }

  const patch = async (channel: ChannelRecord, changes: Partial<ChannelRecord>): Promise<void> => {
    try {
      const updated = await updateChannel(channel.id, {
        title: changes.title ?? channel.title,
        category: changes.category ?? channel.category,
        accessRole: changes.accessRole ?? channel.accessRole,
        published: changes.published ?? channel.published
      })
      setChannels((current) => current.map((row) => (row.id === updated.id ? updated : row)))
      notify('Channel updated', 'success')
    } catch (caught) {
      setError(caught instanceof TelegramLoginError ? caught.message : 'Channel could not be updated.')
    }
  }

  return (
    <>
      <div className="premium-post-form settings-card" style={{ padding: 14 }}>
        <strong>Add a Telegram channel</strong>
        <p className="form-help">
          Your own channel is already built in. Paste any other channel id (from its invite link or a bot like
          @userinfobot) to add it. You create and delete; the name is editable below.
        </p>
        <input value={newId} onChange={(event) => setNewId(event.target.value)} placeholder="Channel id, e.g. -100…" inputMode="numeric" />
        <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Channel name" maxLength={120} />
        <input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="Category" maxLength={48} />
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="primary-button" type="button" disabled={busy} onClick={() => void add()}>
          {busy ? 'Adding…' : 'Add channel'}
        </button>
      </div>

      <div className="settings-card">
        <div className="setting-row"><span><strong>Channels</strong></span><small>{channels.length}</small></div>
        {channels.length === 0 && <p className="form-help" style={{ margin: 0 }}>No channels yet — the built-in one appears after the first load.</p>}
        {channels.map((channel) => (
          <div className="setting-row" key={channel.id} style={{ flexWrap: 'wrap', gap: 8 }}>
            <span>
              <strong>{channel.title}</strong>
              <small>{channel.id} · {channel.category} · {channel.published ? 'visible' : 'hidden'} · {ACCESS_LABELS.find(([value]) => value === channel.accessRole)?.[1] ?? channel.accessRole}</small>
            </span>
            {editing === channel.id ? (
              <>
                <input defaultValue={channel.title} maxLength={120} onBlur={(event) => void patch(channel, { title: event.target.value })} />
                <input defaultValue={channel.category} maxLength={48} onBlur={(event) => void patch(channel, { category: event.target.value })} />
                <button className="text-button" type="button" onClick={() => setEditing(null)}>Done</button>
              </>
            ) : (
              <>
                <button className="text-button" type="button" onClick={() => setEditing(channel.id)}>Rename</button>
                <button className="text-button" type="button" onClick={() => void patch(channel, { published: !channel.published })}>
                  {channel.published ? 'Hide' : 'Show'}
                </button>
                <button className="text-button" type="button" onClick={() => void remove(channel)}>Delete</button>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
