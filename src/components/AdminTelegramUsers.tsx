import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  addAdmin,
  listAdmins,
  listTelegramUsers,
  removeAdmin,
  setTelegramUserRole,
  setTelegramUserStatus,
  TelegramLoginError,
  type AdminEntry,
  type AppUser
} from '../lib/telegramLogin'
import { roleLabel } from '../lib/roles'
import type { UserRole } from '../types'

const ROLES: UserRole[] = ['normal', 'creator', 'premium', 'vip', 'admin']

/**
 * Who is allowed to administer X-Sutra.
 *
 * Admin rights are data: a Telegram id in xs_admin_telegram_ids (seeded from
 * TELEGRAM_ADMIN_IDS). Nothing secret is shipped to the browser, and the server
 * re-checks the role on every privileged request.
 */
export function AdminTelegramUsers(): React.JSX.Element {
  const { notify } = useApp()
  const [admins, setAdmins] = useState<AdminEntry[]>([])
  const [users, setUsers] = useState<AppUser[]>([])
  const [newAdminId, setNewAdminId] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      setAdmins(await listAdmins())
      setUsers(await listTelegramUsers())
    } catch (caught) {
      setError(caught instanceof TelegramLoginError ? caught.message : 'Telegram accounts could not load.')
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const add = async (): Promise<void> => {
    const id = newAdminId.trim()
    if (!/^\d+$/.test(id)) {
      setError('A Telegram id is numeric — send /start to @userinfobot to get yours.')
      return
    }
    setBusy(true)
    setError('')
    try {
      setAdmins(await addAdmin(id, label.trim()))
      setNewAdminId('')
      setLabel('')
      notify(`${id} is now an admin`, 'success')
      await reload()
    } catch (caught) {
      setError(caught instanceof TelegramLoginError ? caught.message : 'Could not add the admin.')
    } finally {
      setBusy(false)
    }
  }

  const drop = async (telegramId: string): Promise<void> => {
    if (!window.confirm(`Remove ${telegramId} from the admin list?`)) return
    try {
      setAdmins(await removeAdmin(telegramId))
      notify('Admin removed', 'success')
      await reload()
    } catch (caught) {
      setError(caught instanceof TelegramLoginError ? caught.message : 'Could not remove the admin.')
    }
  }

  const changeRole = async (user: AppUser, role: UserRole): Promise<void> => {
    try {
      const updated = await setTelegramUserRole(user.telegramId, role)
      setUsers((current) => current.map((row) => (row.telegramId === updated.telegramId ? updated : row)))
      notify(`${updated.name} → ${roleLabel(role)}`, 'success')
    } catch (caught) {
      setError(caught instanceof TelegramLoginError ? caught.message : 'Role could not be changed.')
    }
  }

  const toggleStatus = async (user: AppUser): Promise<void> => {
    try {
      const updated = await setTelegramUserStatus(user.telegramId, user.status === 'off' ? 'on' : 'off')
      setUsers((current) => current.map((row) => (row.telegramId === updated.telegramId ? updated : row)))
      notify(updated.status === 'off' ? `${updated.name} disabled` : `${updated.name} enabled`, 'success')
    } catch (caught) {
      setError(caught instanceof TelegramLoginError ? caught.message : 'Status could not be changed.')
    }
  }

  return (
    <>
      <div className="premium-post-form settings-card" style={{ padding: 14 }}>
        <strong>Admin Telegram IDs</strong>
        <p className="form-help">
          Only these Telegram accounts get admin access — the role is stored in your database and re-checked on the
          server for every upload. Send <code>/start</code> to <code>@userinfobot</code> to read an id.
        </p>
        <input value={newAdminId} onChange={(event) => setNewAdminId(event.target.value)} placeholder="Telegram id, e.g. 123456789" inputMode="numeric" />
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Optional note (owner, editor…)" maxLength={60} />
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="primary-button" type="button" disabled={busy} onClick={() => void add()}>
          {busy ? 'Saving…' : 'Add admin'}
        </button>
      </div>

      <div className="settings-card">
        <div className="setting-row"><span><strong>Admins</strong></span><small>{admins.length}</small></div>
        {admins.length === 0 && <p className="form-help" style={{ margin: 0 }}>No admin yet — add your Telegram id above.</p>}
        {admins.map((admin) => (
          <div className="setting-row" key={admin.telegramId}>
            <span><strong>{admin.telegramId}</strong><small>{admin.label || 'no note'}</small></span>
            <button className="text-button" type="button" onClick={() => void drop(admin.telegramId)}>Remove</button>
          </div>
        ))}
      </div>

      <div className="settings-card">
        <div className="setting-row"><span><strong>Telegram accounts</strong></span><small>{users.length}</small></div>
        {users.length === 0 && <p className="form-help" style={{ margin: 0 }}>Nobody has signed in with Telegram yet.</p>}
        {users.map((user) => (
          <div className="setting-row" key={user.telegramId} style={{ flexWrap: 'wrap', gap: 8 }}>
            <span>
              <strong>{user.name}</strong>
              <small>{user.telegramId}{user.username ? ` · @${user.username}` : ''} · {user.status === 'off' ? 'disabled' : 'active'}</small>
            </span>
            <select value={user.role} onChange={(event) => void changeRole(user, event.target.value as UserRole)}>
              {ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
            </select>
            <button className="text-button" type="button" onClick={() => void toggleStatus(user)}>{user.status === 'off' ? 'Enable' : 'Disable'}</button>
          </div>
        ))}
      </div>
    </>
  )
}
