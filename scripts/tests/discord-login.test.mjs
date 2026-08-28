import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

// Point the functions at fixture credentials before they are imported.
process.env.DISCORD_CLIENT_ID = 'client-123'
process.env.DISCORD_CLIENT_SECRET = 'secret-456'

const { handler: loginHandler } = await import('../../netlify/functions/discord-login.mjs')
const { handler: callbackHandler } = await import('../../netlify/functions/discord-callback.mjs')
const { handler: refreshHandler } = await import('../../netlify/functions/discord-refresh.mjs')
const { normalizeOrigin, toPublicProfile } = await import('../../netlify/functions/_discord-oauth.mjs')

const event = ({ method, query = {}, body = '' }) => ({
  httpMethod: method,
  queryStringParameters: query,
  headers: {},
  body,
  isBase64Encoded: false
})

const discordUser = { id: '7001', username: 'sutrafan', global_name: 'Sutra Fan', avatar: 'abc123', email: 'fan@example.com' }
const tokenPayload = {
  access_token: 'at-1',
  refresh_token: 'rt-1',
  expires_in: 3600,
  token_type: 'Bearer',
  scope: 'identify offline_access'
}

let tokenCalls = []
let meCalls = []
let tokenResponse = tokenPayload
let meStatus = 200
let meBody = discordUser

// Stub every outbound Discord call; nothing else touches the network here.
globalThis.fetch = async (url, options = {}) => {
  const target = String(url)
  if (target.startsWith('https://discord.com/api/v10/oauth2/token')) {
    tokenCalls.push(options.body)
    const body = tokenResponse
    const status = tokenResponse.__status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    }
  }
  if (target.startsWith('https://discord.com/api/v10/users/@me')) {
    meCalls.push(options.headers.Authorization)
    return {
      ok: meStatus >= 200 && meStatus < 300,
      status: meStatus,
      json: async () => meBody
    }
  }
  throw new Error(`Unexpected fetch: ${target}`)
}

after(() => {
  delete globalThis.fetch
})

const parse = (result) => JSON.parse(result.body)

describe('discord-login: the authorize redirect', () => {
  it('302s to discord.com with the app client id and the caller origin as redirect_uri', async () => {
    const result = await loginHandler(event({
      method: 'GET',
      query: { origin: 'https://redgrab.vercel.app/some/path', state: 'abc_123-XYZ' }
    }))
    assert.equal(result.statusCode, 302)
    const location = new URL(result.headers.Location)
    assert.equal(location.origin, 'https://discord.com')
    assert.equal(location.pathname, '/oauth2/authorize')
    assert.equal(location.searchParams.get('client_id'), 'client-123')
    // Root origin: the app is hash-routed and reads ?code from location.search.
    assert.equal(location.searchParams.get('redirect_uri'), 'https://redgrab.vercel.app')
    assert.equal(location.searchParams.get('response_type'), 'code')
    assert.equal(location.searchParams.get('scope'), 'identify offline_access')
    assert.equal(location.searchParams.get('state'), 'abc_123-XYZ')
  })

  it('normalizes the origin and rejects non-http(s) or missing values', async () => {
    // Path/query are stripped to the bare origin (Discord still enforces that
    // the redirect_uri is one the app registered, so this cannot be abused).
    const withPath = await loginHandler(event({ method: 'GET', query: { origin: 'https://x.example/deep/path?q=1', state: 's1' } }))
    assert.equal(withPath.statusCode, 302)
    assert.equal(new URL(withPath.headers.Location).searchParams.get('redirect_uri'), 'https://x.example')
    const jsUrl = await loginHandler(event({ method: 'GET', query: { origin: 'javascript:alert(1)', state: 's1' } }))
    assert.equal(jsUrl.statusCode, 400)
    const garbage = await loginHandler(event({ method: 'GET', query: { origin: 'not a url', state: 's1' } }))
    assert.equal(garbage.statusCode, 400)
    const noOrigin = await loginHandler(event({ method: 'GET', query: { state: 's1' } }))
    assert.equal(noOrigin.statusCode, 400)
    const noState = await loginHandler(event({ method: 'GET', query: { origin: 'https://x.example' } }))
    assert.equal(noState.statusCode, 400)
    assert.equal(normalizeOrigin('javascript:alert(1)'), '')
    assert.equal(normalizeOrigin('not a url'), '')
    assert.equal(normalizeOrigin('https://x.example/a/b?c=1#d'), 'https://x.example')
  })

  it('answers GET only and shows a friendly page when unconfigured', async () => {
    const method = await loginHandler(event({ method: 'POST', query: { origin: 'https://x.example', state: 's1' } }))
    assert.equal(method.statusCode, 405)
    const savedId = process.env.DISCORD_CLIENT_ID
    const savedSecret = process.env.DISCORD_CLIENT_SECRET
    delete process.env.DISCORD_CLIENT_ID
    delete process.env.DISCORD_CLIENT_SECRET
    try {
      const result = await loginHandler(event({ method: 'GET', query: { origin: 'https://x.example', state: 's1' } }))
      assert.equal(result.statusCode, 501)
      assert.match(result.body, /Discord login is not set up/i)
      const saved = await callbackHandler(event({ method: 'POST', body: JSON.stringify({ code: 'c', origin: 'https://x.example' }) }))
      assert.equal(saved.statusCode, 501)
      assert.equal(parse(saved).ok, false)
    } finally {
      process.env.DISCORD_CLIENT_ID = savedId
      process.env.DISCORD_CLIENT_SECRET = savedSecret
    }
  })
})

describe('discord-callback: code → session', () => {
  it('exchanges the code and returns only the public profile plus tokens', async () => {
    tokenCalls = []
    meCalls = []
    const result = await callbackHandler(event({
      method: 'POST',
      body: JSON.stringify({ code: 'code-abc', origin: 'https://redgrab.vercel.app' })
    }))
    assert.equal(result.statusCode, 200)
    const data = parse(result)
    assert.equal(data.ok, true)
    assert.equal(data.accessToken, 'at-1')
    assert.equal(data.refreshToken, 'rt-1')
    assert.ok(data.expiresAt > Date.now())
    assert.deepEqual(data.profile, toPublicProfile(discordUser))
    // The secret was sent form-encoded to the token endpoint, never to the client.
    const sent = new URLSearchParams(tokenCalls[0])
    assert.equal(sent.get('client_id'), 'client-123')
    assert.equal(sent.get('client_secret'), 'secret-456')
    assert.equal(sent.get('grant_type'), 'authorization_code')
    assert.equal(sent.get('code'), 'code-abc')
    assert.equal(sent.get('redirect_uri'), 'https://redgrab.vercel.app')
    assert.equal(meCalls[0], 'Bearer at-1')
    // Nothing sensitive leaks into the response.
    assert.ok(!result.body.includes('secret-456'))
    assert.ok(!result.body.includes('fan@example.com'))
  })

  it('requires code + origin and surfaces Discord errors as ok:false', async () => {
    const missing = await callbackHandler(event({ method: 'POST', body: JSON.stringify({ code: 'c' }) }))
    assert.equal(missing.statusCode, 400)
    tokenResponse = { __status: 400, error: 'invalid_grant', error_description: 'Invalid Authorization code: the code expired.' }
    const expired = await callbackHandler(event({ method: 'POST', body: JSON.stringify({ code: 'old', origin: 'https://x.example' }) }))
    assert.equal(expired.statusCode, 401)
    assert.equal(parse(expired).ok, false)
    assert.match(parse(expired).error, /Invalid Authorization code/)
    tokenResponse = tokenPayload
  })
})

describe('discord-refresh: silent token renewal', () => {
  it('renews with grant_type=refresh_token and returns a fresh session', async () => {
    tokenCalls = []
    const result = await refreshHandler(event({
      method: 'POST',
      body: JSON.stringify({ refreshToken: 'rt-1', origin: 'https://redgrab.vercel.app' })
    }))
    assert.equal(result.statusCode, 200)
    const data = parse(result)
    assert.equal(data.ok, true)
    assert.equal(data.accessToken, 'at-1')
    const sent = new URLSearchParams(tokenCalls[0])
    assert.equal(sent.get('grant_type'), 'refresh_token')
    assert.equal(sent.get('refresh_token'), 'rt-1')
    assert.equal(sent.get('client_secret'), 'secret-456')
  })

  it('fails cleanly when Discord revokes the refresh token', async () => {
    tokenResponse = { __status: 400, error: 'invalid_grant', error_description: 'Invalid refresh token.' }
    try {
      const result = await refreshHandler(event({
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'dead', origin: 'https://x.example' })
      }))
      assert.equal(result.statusCode, 401)
      assert.equal(parse(result).ok, false)
    } finally {
      tokenResponse = tokenPayload
    }
  })
})
