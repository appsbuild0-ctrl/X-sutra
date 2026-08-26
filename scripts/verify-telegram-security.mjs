import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SignJWT } from 'jose'

process.env.ADMIN_SETUP_SECRET ||= 'test-only-bootstrap-value-with-sufficient-length'
process.env.SESSION_ENCRYPTION_KEY ||= 'test-only-encryption-value-with-sufficient-length'
process.env.AUTH_JWT_SECRET ||= 'test-only-jwt-value-with-sufficient-length'

const { encryptSecret, decryptSecret, requireOwner, requireRole, signOwnerToken, verifyOwnerToken } = await import('../netlify/functions/_server/security.mjs')
const secret = new TextEncoder().encode(process.env.AUTH_JWT_SECRET)
const token = (role) => new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(`test-${role}`).setIssuer('x-sutra').setExpirationTime('5m').sign(secret)
const event = (value) => ({ headers: value ? { authorization: `Bearer ${value}` } : {} })
const secretEvent = (value) => ({ headers: { 'x-admin-setup-secret': value } })

await assert.rejects(() => requireRole(event(), ['premium', 'vip', 'admin']), (error) => error.statusCode === 401)
await assert.rejects(() => token('normal').then((value) => requireRole(event(value), ['premium', 'vip', 'admin'])), (error) => error.statusCode === 403)
assert.equal((await requireRole(event(await token('premium')))).role, 'premium')
assert.equal((await requireRole(event(await token('vip')))).role, 'vip')
const encrypted = encryptSecret('private-test-session')
assert.notEqual(encrypted, 'private-test-session')
assert.equal(decryptSecret(encrypted), 'private-test-session')

// One-time Telegram login: the owner token is issued once and then unlocks the
// console on its own, while the bootstrap secret stays a first-login-only path.
const issued = await signOwnerToken('12345')
assert.ok(issued.ownerToken.length > 40, 'owner token must be a signed JWT')
assert.equal((await verifyOwnerToken(issued.ownerToken)).tid, '12345')
assert.equal((await requireOwner(event(issued.ownerToken))).via, 'token')
assert.equal((await requireOwner(secretEvent(process.env.ADMIN_SETUP_SECRET))).via, 'secret')
await assert.rejects(() => requireOwner(event('not-a-real-token')), (error) => error.statusCode === 401)
await assert.rejects(async () => requireOwner(event(await token('admin'))), (error) => error.statusCode === 401, 'a premium/admin feed token must not unlock the owner console')
await assert.rejects(() => requireOwner(secretEvent('wrong-secret')), (error) => error.statusCode === 401)
await assert.rejects(() => requireOwner({ headers: {} }), (error) => error.statusCode === 401)

// The console is deliberately simple: it performs the Telegram OTP login and
// stores only the signed owner session token. No setup secret is ever asked,
// sent, or persisted by the client; only lib/telegramOwner.ts touches storage.
const adminClient = await readFile('src/lib/telegramAdmin.ts', 'utf8')
const adminCard = await readFile('src/components/TelegramAdminCard.tsx', 'utf8')
const ownerStore = await readFile('src/lib/telegramOwner.ts', 'utf8')
assert.doesNotMatch(adminClient, /x-admin-setup-secret|ADMIN_SETUP_SECRET/i, 'The simple console must never send a setup secret')
assert.match(adminClient, /authorization: `Bearer \$\{owner\.token\}`/, 'Telegram admin client must reuse the saved owner session')
// Strip comments first: the UI code itself must never render a setup-secret
// field (doc comments may still explain the design).
const cardCode = adminCard.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
assert.doesNotMatch(cardCode, /setup secret|Admin setup|ADMIN_SETUP_SECRET/i, 'The console must never ask for a setup secret')
assert.doesNotMatch(
  `${adminClient}\n${adminCard}`,
  /localStorage\.|sessionStorage\.|writeStored\(|readStored\(/,
  'The console must never touch persistent storage directly'
)
assert.match(ownerStore, /x-sutra\.telegram\.owner\.session\.v1/, 'Owner session must live under its own storage key')
// Comments may explain the rule; the code itself must never touch the secret.
const ownerCode = ownerStore.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
assert.doesNotMatch(ownerCode, /secret/i, 'The owner session store must never hold the bootstrap secret')
assert.match(ownerCode, /window\.localStorage\.setItem\(KEY/, 'Only the signed owner token may be persisted')
const panel = await readFile('src/screens/AdminPanelScreen.tsx', 'utf8')
assert.match(panel, /account\.role !== 'admin'/, 'Admin panel must keep the admin-only gate')
console.log('Telegram security checks passed: free denied, premium allowed, session encrypted, owner secret memory-only, owner token issued once and reusable.')
