// End-to-end regression tests for the "Live public data request failed (429)"
// outage, run against the REAL app source (bundled by Vite like production).
//
// Root cause of the production report: every visitor's feed request went
// through the site's proxy, so RedGifs rate-limited the proxy's SHARED egress
// IP and the whole site showed "Live data could not load" at once.
//
// Fixes pinned here:
//   1. The hottest feed (trending page 1 / For You mix) is fetched straight
//      from the browser via the CORS-open no-login source — it never touches
//      the shared proxy IP, so it cannot be mass-rate-limited.
//   2. Proxy fetches retry 429s (honouring the body's error.delay), so a rate
//      -limit blip no longer hard-fails the feed: it recovers on its own.
//   3. When even the retries fail AND every other source is down, the feed
//      shows the error screen with a working retry — and (covered by code
//      review + the paged-media blocker) a background page failure never
//      blanks an already-populated grid.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const bundlePath = path.join(root, '.cache', 'e2e', 'dist-ratelimit', 'app-iife.js')

async function buildAppBundle() {
  await mkdir(path.dirname(bundlePath), { recursive: true })
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    build: {
      outDir: path.join(root, '.cache', 'e2e', 'dist-ratelimit'),
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        input: path.join(root, 'src', 'main.tsx'),
        output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app-iife.js' }
      }
    }
  })
  return readFile(bundlePath, 'utf8')
}

const bundlePromise = buildAppBundle()

function waitFor(check, timeoutMs = 6000, label = 'condition') {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      let value
      try {
        value = check()
      } catch {
        return
      }
      if (value) {
        clearInterval(timer)
        resolve(value)
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`Timed out waiting for ${label}`))
      }
    }, 25)
  })
}

const jsonResponse = (data) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => data,
  text: async () => JSON.stringify(data)
})

const rateLimited = (delaySeconds = 0.05) => ({
  ok: false,
  status: 429,
  headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => ({ error: { code: 'RateLimited', message: 'Too many requests, please retry later.', status: 429, delay: delaySeconds } }),
  text: async () => JSON.stringify({ error: { code: 'RateLimited', message: 'Too many requests, please retry later.', status: 429, delay: delaySeconds } })
})

const notFound = { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => '' }

function grgClip(id, name, userName) {
  return {
    id,
    userName,
    urls: {
      hd: `https://media.redgifs.com/${name}.mp4`,
      sd: `https://media.redgifs.com/${name}-mobile.mp4`,
      silent: `https://media.redgifs.com/${name}-silent.mp4`,
      thumbnail: `https://media.redgifs.com/${name}-mobile.jpg`,
      poster: `https://media.redgifs.com/${name}-poster.jpg`
    }
  }
}

const apiClip = {
  id: 'apiclip01',
  userName: 'e2ecreator',
  duration: 11,
  views: 50,
  likes: 9,
  hasAudio: true,
  tags: ['apiclip'],
  urls: {
    hd: 'https://files.redgifs.com/ApiClip01.mp4',
    sd: 'https://files.redgifs.com/ApiClip01-mobile.mp4',
    poster: 'https://thumbs.redgifs.com/ApiClip01-poster.jpg'
  }
}

async function bootApp(handleRequest) {
  const bundle = await bundlePromise
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('error', () => undefined)

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/#/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  })
  const { window } = dom
  window.scrollTo = () => undefined

  const requested = []
  window.fetch = async (input) => {
    let url = typeof input === 'string' ? input : String((input && input.url) ?? '')
    try { url = decodeURIComponent(url) } catch { /* keep raw */ }
    requested.push(url)
    return (await handleRequest(url)) ?? notFound
  }

  try {
    window.eval(bundle)
    return { window, requested }
  } catch (error) {
    window.close()
    throw error
  }
}

test('trending page 1 bypasses the proxy entirely (direct per-visitor fetch)', async () => {
  const { window, requested } = await bootApp((url) => {
    if (url.includes('getredgifs.com/api/trending')) {
      return jsonResponse({ type: 'trending', feed: 'popular', data: [grgClip('directclip1', 'DirectClipOne', 'creator_a'), grgClip('directclip2', 'DirectClipTwo', 'creator_b')] })
    }
    if (url.includes('/api/redgifs/v2/auth/temporary')) return jsonResponse({ token: 'e2e-token' })
    if (url.includes('/v2/gifs/search')) return jsonResponse({ gifs: [apiClip], page: 1, pages: 1, total: 1 })
    return undefined
  })

  try {
    await waitFor(() => window.document.querySelectorAll('.media-card').length >= 3, 12000, 'three feed cards')

    // The no-login trending batch came straight from the browser — exactly one
    // direct call, and it was the ONLY place those two clips came from.
    assert.equal(
      requested.filter((url) => url.includes('getredgifs.com/api/trending')).length,
      1,
      'trending page 1 must be a single direct browser fetch'
    )
    assert.ok(
      !requested.some((url) => url.includes('order=trending') && url.includes('/api/')),
      'trending page 1 must not consume a proxied API request'
    )
    assert.ok(!window.document.querySelector('.live-error'), 'no error screen while feeds load')
  } finally {
    window.close()
  }
})

test('a 429 rate-limit burst is retried and the feed recovers on its own', async () => {
  let searchCalls = 0
  const { window, requested } = await bootApp((url) => {
    if (url.includes('getredgifs.com/api/trending')) {
      return jsonResponse({ type: 'trending', feed: 'popular', data: [grgClip('directclip1', 'DirectClipOne', 'creator_a')] })
    }
    if (url.includes('/api/redgifs/v2/auth/temporary')) return jsonResponse({ token: 'e2e-token' })
    if (url.includes('/v2/gifs/search')) {
      searchCalls += 1
      // Rate-limited twice, then recovers — the old code failed the whole
      // feed on the FIRST 429.
      return searchCalls <= 2 ? rateLimited() : jsonResponse({ gifs: [apiClip], page: 1, pages: 1, total: 1 })
    }
    return undefined
  })

  try {
    await waitFor(() => [...window.document.querySelectorAll('.media-card__title')].some((node) => node.textContent === 'apiclip'), 15000, 'retried feed card')
    assert.equal(
      requested.filter((url) => url.includes('/v2/gifs/search')).length,
      3,
      'the search request must be retried until the rate limit clears'
    )
    assert.ok(!window.document.querySelector('.live-error'), 'a transient 429 must not show the error screen')
  } finally {
    window.close()
  }
})

test('a persistent rate limit on every source ends at the error screen (with retry), not a crash', async () => {
  const { window } = await bootApp((url) => {
    if (url.includes('/api/redgifs/v2/auth/temporary')) return jsonResponse({ token: 'e2e-token' })
    if (url.includes('/api/redgifs')) return rateLimited(0.01)
    // getredgifs is unreachable too — no source can serve the feed.
    return undefined
  })

  try {
    const errorPanel = await waitFor(() => window.document.querySelector('.live-error'), 25000, 'feed error screen')
    assert.match(errorPanel.textContent ?? '', /429|retry|rate/i)
    assert.ok([...errorPanel.querySelectorAll('button')].some((button) => /try again/i.test(button.textContent ?? '')), 'error screen keeps its retry button')
  } finally {
    window.close()
  }
})
