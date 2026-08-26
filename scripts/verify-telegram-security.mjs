import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SignJWT } from 'jose'

process.env.ADMIN_SETUP_SECRET ||= 'test-only-bootstrap-value-with-sufficient-length'
process.env.SESSION_ENCRYPTION_KEY ||= 'test-only-encryption-value-with-sufficient-length'
process.env.AUTH_JWT_SECRET ||= 'test-only-jwt-value-with-sufficient-length'

const { encryptSecret, decryptSecret, requireRole } = await import('../netlify/functions/_server/security.mjs')
const secret = new TextEncoder().encode(process.env.AUTH_JWT_SECRET)
const token = (role) => new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(`test-${role}`).setIssuer('x-sutra').setExpirationTime('5m').sign(secret)
const event = (value) => ({ headers: value ? { authorization: `Bearer ${value}` } : {} })

await assert.rejects(() => requireRole(event(), ['premium', 'vip', 'admin']), (error) => error.statusCode === 401)
await assert.rejects(() => token('normal').then((value) => requireRole(event(value), ['premium', 'vip', 'admin'])), (error) => error.statusCode === 403)
assert.equal((await requireRole(event(await token('premium')))).role, 'premium')
assert.equal((await requireRole(event(await token('vip')))).role, 'vip')
const encrypted = encryptSecret('private-test-session')
assert.notEqual(encrypted, 'private-test-session')
assert.equal(decryptSecret(encrypted), 'private-test-session')

// The owner-only admin console must keep the setup secret in memory only and
// stay behind the admin role gate in the panel.
const adminClient = await readFile('src/lib/telegramAdmin.ts', 'utf8')
const adminCard = await readFile('src/components/TelegramAdminCard.tsx', 'utf8')
assert.match(adminClient, /x-admin-setup-secret/, 'Telegram admin client must send the bootstrap secret header')
assert.doesNotMatch(
  `${adminClient}\n${adminCard}`,
  /localStorage\.|sessionStorage\.|writeStored\(|readStored\(/,
  'The admin setup secret must never touch persistent storage'
)
const panel = await readFile('src/screens/AdminPanelScreen.tsx', 'utf8')
assert.match(panel, /account\.role !== 'admin'/, 'Admin panel must keep the admin-only gate')
console.log('Telegram security checks passed: free denied, premium allowed, session encrypted, owner secret memory-only.')
