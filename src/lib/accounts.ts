import type { AuthResult, LocalAccount, UserRole } from '../types'
import { readStored, writeStored } from './storage'
import { cacheHub, localHub, saveHub } from './adminHub'

export const USERS_KEY = 'x-sutra.accounts.registry.v1'
const SESSION_KEY = 'x-sutra.session.local.v1'
const LEGACY_ACCOUNT_KEY = 'x-sutra.account.local.v1'
const ACCOUNTS_EVENT = 'xs-accounts-changed'

export async function hashSecret(text: string): Promise<string> {
  try {
    if (globalThis.crypto?.subtle) {
      const bytes = new TextEncoder().encode(text)
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    }
  } catch { /* insecure context */ }
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash) ^ text.charCodeAt(index)
  return `fb:${(hash >>> 0).toString(16)}:${text.length}`
}

function emitAccounts(): void {
  window.dispatchEvent(new Event(ACCOUNTS_EVENT))
}

export function onAccountsChange(listener: () => void): () => void {
  window.addEventListener(ACCOUNTS_EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(ACCOUNTS_EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

export function readUsers(): LocalAccount[] {
  const users = readStored<LocalAccount[]>(USERS_KEY, [])
  const legacy = readStored<LocalAccount | null>(LEGACY_ACCOUNT_KEY, null)
  if (legacy?.username && !users.some((user) => user.username === legacy.username)) {
    const role: LocalAccount['role'] = legacy.role === 'admin' ? 'admin' : (legacy.role === 'premium' || legacy.role === 'vip' || legacy.role === 'normal' || legacy.role === 'creator' ? legacy.role : 'creator')
    const migrated = [...users, { ...legacy, role, status: legacy.status || 'on' }]
    writeStored(USERS_KEY, migrated)
    return migrated
  }
  return users
}

function writeUsers(users: LocalAccount[]): LocalAccount[] {
  writeStored(USERS_KEY, users)
  const hub = localHub()
  cacheHub({
    ...hub,
    users: users.map((user) => ({
      username: user.username,
      role: user.role,
      status: user.status || 'on',
      createdAt: user.createdAt
    }))
  })
  emitAccounts()
  return users
}

export function publicUsers(): Array<Pick<LocalAccount, 'username' | 'role' | 'status' | 'createdAt' | 'name'>> {
  return readUsers().map(({ username, role, status, createdAt, name }) => ({ username, role, status, createdAt, name }))
}

export function findUser(username: string): LocalAccount | undefined {
  return readUsers().find((user) => user.username === username.trim().toLowerCase())
}

export function writeSession(account: LocalAccount): void {
  writeStored(SESSION_KEY, { username: account.username, role: account.role, name: account.name, createdAt: account.createdAt, status: account.status, passwordHash: '' })
}

export function readSession(): LocalAccount | null {
  const session = readStored<LocalAccount | null>(SESSION_KEY, null)
  if (!session?.username) return null
  if (session.username === 'admin' && session.role === 'admin') {
    return { ...session, passwordHash: '', status: 'on', role: 'admin' }
  }
  const live = findUser(session.username)
  if (!live || live.status === 'off') return null
  return { ...live, passwordHash: '' }
}

export async function createUser(input: { name?: string; username: string; password: string; role: UserRole }): Promise<AuthResult & { user?: LocalAccount }> {
  const username = input.username.trim().toLowerCase()
  if (username === 'admin') return { ok: false, error: 'That username is reserved' }
  if (!/^[a-z0-9._]{3,20}$/i.test(username)) return { ok: false, error: 'Username: 3-20 letters, numbers, dot or underscore' }
  if (input.password.length < 4) return { ok: false, error: 'Password must be at least 4 characters' }
  if (findUser(username)) return { ok: false, error: `Username @${username} is already taken` }
  const role = input.role === 'admin' ? 'creator' : input.role
  const record: LocalAccount = {
    name: (input.name || username).trim().slice(0, 40),
    username,
    passwordHash: await hashSecret(input.password),
    createdAt: new Date().toISOString(),
    role,
    status: 'on'
  }
  const users = [...readUsers(), record]
  writeUsers(users)
  void saveHub(localHub())
  return { ok: true, user: { ...record, passwordHash: '' } }
}

export async function verifyLogin(username: string, password: string): Promise<AuthResult & { user?: LocalAccount }> {
  const clean = username.trim().toLowerCase()
  if (clean === 'admin') {
    const ok = password === 'admin123' || password === 'admin'
    if (!ok) return { ok: false, error: 'Incorrect password' }
    const admin: LocalAccount = { name: 'Admin', username: 'admin', passwordHash: '', createdAt: new Date().toISOString(), role: 'admin', status: 'on' }
    return { ok: true, user: admin }
  }
  const stored = findUser(clean)
  if (!stored) return { ok: false, error: 'No account with that username' }
  if (stored.status === 'off') return { ok: false, error: 'This account is disabled' }
  if (stored.passwordHash !== await hashSecret(password)) return { ok: false, error: 'Incorrect password' }
  return { ok: true, user: { ...stored, passwordHash: '' } }
}

export async function resetUserPassword(username: string, password: string): Promise<AuthResult> {
  if (password.length < 4) return { ok: false, error: 'Password must be at least 4 characters' }
  const users = readUsers()
  const index = users.findIndex((user) => user.username === username)
  if (index < 0) return { ok: false, error: 'User not found' }
  users[index] = { ...users[index], passwordHash: await hashSecret(password) }
  writeUsers(users)
  return { ok: true }
}

export function patchUser(username: string, patch: Partial<Pick<LocalAccount, 'role' | 'status' | 'name'>>): AuthResult {
  const users = readUsers()
  const index = users.findIndex((user) => user.username === username)
  if (index < 0 && username !== 'admin') return { ok: false, error: 'User not found' }
  if (username === 'admin') return { ok: false, error: 'The administrator account cannot be edited here' }
  users[index] = { ...users[index], ...patch }
  writeUsers(users)
  void saveHub(localHub())
  return { ok: true }
}

export function deleteUser(username: string): AuthResult {
  if (username === 'admin') return { ok: false, error: 'The administrator account cannot be deleted' }
  writeUsers(readUsers().filter((user) => user.username !== username))
  void saveHub(localHub())
  return { ok: true }
}
