// End-to-end regression test for the feed video "blink" bug, run against the
// REAL app source (bundled by Vite exactly like production, as a single IIFE
// so jsdom can execute it):
//
//   1. Boot the app at #/ with a stubbed public API that returns ONE feed clip
//      whose search-page entry already carries full media URLs (so the card
//      renders with real thumbnails).
//   2. Exhaust the card thumbnails (fire load errors, like a flaky mobile
//      network does) so the card switches to its <video> preview branch.
//   3. Only THEN release the lazy detail hydration response (/v2/gifs/:id,
//      same media URLs, updated like count) and watch it land ("999 likes").
//   4. Expect the video preview to survive hydration untouched: same element,
//      same src. Before the fix, hydration changed an unrelated dependency of
//      the video setup effect, whose cleanup wiped video.src while React kept
//      the element — the preview blinked black / "Video unavailable".
//   5. Expect the feed to stay at rest afterwards: the old reload effect
//      refetched page 1 forever (~1/sec), endlessly re-shuffling and blinking
//      the whole home feed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const bundlePath = path.join(root, '.cache', 'e2e', 'dist-blink', 'app-iife.js')

async function buildAppBundle() {
  await mkdir(path.dirname(bundlePath), { recursive: true })
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    build: {
      outDir: path.join(root, '.cache', 'e2e', 'dist-blink'),
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

function waitFor(check, timeoutMs = 5000, label = 'condition') {
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

const notFound = { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => '' }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// One public clip. mediaFromRaw derives a clean URL set from the file name, so
// the card gets previewUrl = .../BlinkFix01-silent.mp4 — a direct <video>
// preview source. The detail response repeats the SAME urls (hydration keeps
// media stable in practice) and only bumps likes to make hydration visible.
const feedGif = {
  id: 'blinkfix01',
  userName: 'e2ecreator',
  duration: 12,
  views: 40,
  likes: 5,
  hasAudio: false,
  tags: ['stable'],
  urls: {
    hd: 'https://files.redgifs.com/BlinkFix01.mp4',
    sd: 'https://files.redgifs.com/BlinkFix01-mobile.mp4',
    poster: 'https://thumbs.redgifs.com/BlinkFix01-poster.jpg'
  }
}
const hydratedGif = { ...feedGif, likes: 999 }

test('feed video previews never blink black when lazy detail hydration lands', async () => {
  const bundle = await buildAppBundle()

  const virtualConsole = new VirtualConsole()
  virtualConsole.on('error', () => undefined) // swallow app console noise

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/#/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  })
  const { window } = dom
  window.scrollTo = () => undefined

  const requested = []
  // Gate the detail response so hydration lands only after the video preview
  // is already on screen — the exact ordering that produced the blink.
  let releaseDetail = () => undefined
  const detailGate = new Promise((resolve) => { releaseDetail = resolve })

  window.fetch = async (input, options) => {
    let url = typeof input === 'string' ? input : String((input && input.url) ?? '')
    try { url = decodeURIComponent(url) } catch { /* keep raw */ }
    requested.push(url)
    if (url.includes('/api/redgifs/v2/auth/temporary')) {
      return jsonResponse({ token: 'e2e-token' })
    }
    if (url.includes('/v2/gifs/search')) {
      return jsonResponse({ gifs: [feedGif], page: 1, pages: 1, total: 1 })
    }
    if (url.includes('/v2/gifs/blinkfix01')) {
      await detailGate
      return jsonResponse({ gif: hydratedGif })
    }
    return notFound
  }

  try {
    window.eval(bundle)

    // 1. The home feed renders our clip.
    const card = await waitFor(() => window.document.querySelector('.media-card'), 5000, 'media card')

    // 2. Exhaust the thumbnail chain (flaky-network behaviour) so the card
    //    switches to its live <video> preview branch.
    const video = await waitFor(() => {
      const existing = card.querySelector('video')
      if (existing) return existing
      const img = card.querySelector('img')
      if (img) img.dispatchEvent(new window.Event('error'))
      return null
    }, 5000, 'video preview branch')
    const srcBefore = video.getAttribute('src')
    assert.ok(/BlinkFix01.*\.mp4/.test(srcBefore ?? ''), `video preview starts on the clean mp4 (got: ${srcBefore})`)

    // 3. Release hydration and watch it land via the meta row.
    releaseDetail()
    await waitFor(() => card.querySelector('.media-card__meta')?.textContent?.includes('999 likes'), 5000, 'hydrated like count')
    assert.ok(
      requested.some((url) => url.includes('/v2/gifs/blinkfix01')),
      'the detail endpoint was actually requested'
    )

    // 4. The very same <video> element must still carry its source — no blink.
    const videoAfter = card.querySelector('video')
    assert.equal(videoAfter, video, 'hydration must not remount the video element')
    const srcAfter = videoAfter?.getAttribute('src')
    assert.equal(srcAfter, srcBefore, `hydration must not wipe or swap the playing preview source (got: ${srcAfter})`)

    // 5. The feed must be at rest: no refetch loop re-loading page 1 forever.
    await sleep(1800)
    const searchesAfterSettle = requested.filter((url) => url.includes('/v2/gifs/search')).length
    await sleep(1800)
    const searchesLater = requested.filter((url) => url.includes('/v2/gifs/search')).length
    assert.equal(searchesLater, searchesAfterSettle, 'feed must not keep refetching the first page in a loop')
  } finally {
    // Always stop jsdom's timers so the test process exits even on failure.
    window.close()
  }
})
