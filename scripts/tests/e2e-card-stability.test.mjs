// End-to-end regression tests for the "cards go empty / cards blink" report,
// run against the REAL app source (bundled by Vite exactly like production, as
// a single IIFE so jsdom can execute it). Three failure modes are pinned down:
//
//   1. EMPTY CARDS ON DETAIL FAILURE — a feed card that already had working
//      media used to fire a lazy /v2/gifs/:id request the moment it scrolled
//      into view; when that request failed (rate limit, proxy hiccup), the
//      card swapped its real content for a bogus "{ title: 'Loading…' }"
//      placeholder with no thumbnails and stayed empty forever. Premium cards
//      (pm-/hp- ids) took the same path unconditionally, which is why Premium
//      and Library grids rendered rows of empty tiles. Now a card that has
//      usable media never fetches detail, premium cards never fetch at all,
//      and a failed fetch simply keeps the feed item on screen.
//   2. BLINK ON HYDRATION — when a detail response did land, the card replaced
//      the whole item, so the <img>/<video> remounted with a different source
//      and every card visibly flickered. mergeHydrated now keeps the visible
//      media identity and only refreshes stats.
//   3. DUPLICATE GRID KEYS — the For You feed mixes trending + latest pages,
//      which overlap heavily; duplicate ids became duplicate React keys and
//      remounted cards mid-scroll. Home dedupes the mix and MediaGrid dedupes
//      again as a last line of defence.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const bundlePath = path.join(root, '.cache', 'e2e', 'dist-stability', 'app-iife.js')

async function buildAppBundle() {
  await mkdir(path.dirname(bundlePath), { recursive: true })
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    build: {
      outDir: path.join(root, '.cache', 'e2e', 'dist-stability'),
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

// Build once for the whole file — the bundle is identical for every boot.
const bundlePromise = buildAppBundle()

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

/**
 * Boot the real app in jsdom. `handleRequest(url)` is called (after URL
 * decoding) for every fetch; return a response or fall back to 404. All
 * requested URLs are recorded on the returned `requested` array.
 */
async function bootApp({ route = '/', storage = {}, handleRequest }) {
  const bundle = await bundlePromise

  const virtualConsole = new VirtualConsole()
  virtualConsole.on('error', () => undefined) // swallow app console noise

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `http://localhost/#${route}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  })
  const { window } = dom
  window.scrollTo = () => undefined
  for (const [key, value] of Object.entries(storage)) {
    window.localStorage.setItem(key, value)
  }

  const requested = []
  window.fetch = async (input) => {
    let url = typeof input === 'string' ? input : String((input && input.url) ?? '')
    try { url = decodeURIComponent(url) } catch { /* keep raw */ }
    requested.push(url)
    return (await handleRequest?.(url)) ?? notFound
  }

  try {
    window.eval(bundle)
    return { window, requested }
  } catch (error) {
    window.close()
    throw error
  }
}

// ---------------------------------------------------------------------------
// 1. A feed card that already has media must never empty out: no lazy detail
//    fetch, no placeholder shell, and the duplicate (trending+latest) entry
//    must collapse into ONE card.
// ---------------------------------------------------------------------------
test('cards with feed media stay populated and deduplicated (no empty/blink)', async () => {
  const feedGif = {
    id: 'stablecard01',
    userName: 'e2ecreator',
    duration: 12,
    views: 40,
    likes: 5,
    hasAudio: false,
    tags: ['stabletag'],
    urls: {
      hd: 'https://files.redgifs.com/StableCard01.mp4',
      sd: 'https://files.redgifs.com/StableCard01-mobile.mp4',
      poster: 'https://thumbs.redgifs.com/StableCard01-poster.jpg'
    }
  }

  const { window, requested } = await bootApp({
    route: '/',
    handleRequest: (url) => {
      if (url.includes('/api/redgifs/v2/auth/temporary')) return jsonResponse({ token: 'e2e-token' })
      // Both trending and latest search calls return the SAME clip — the
      // classic duplicate-source situation in the For You feed.
      if (url.includes('/v2/gifs/search')) return jsonResponse({ gifs: [feedGif], page: 1, pages: 1, total: 1 })
      if (url.includes('/v2/gifs/stablecard01')) {
        // Detail endpoint is effectively down (rate limited).
        return { ok: false, status: 500, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => 'rate limited' }
      }
      return undefined
    }
  })

  try {
    const card = await waitFor(() => window.document.querySelector('.media-card'), 5000, 'media card')

    // Duplicate ids from the trending+latest mix collapse into one card.
    assert.equal(window.document.querySelectorAll('.media-card').length, 1, 'duplicate ids must render a single card')

    const img = await waitFor(() => card.querySelector('img'), 5000, 'thumbnail image')
    assert.match(img.getAttribute('src') ?? '', /StableCard01-poster\.jpg/)
    assert.equal(card.querySelector('.media-card__title')?.textContent, 'stabletag')

    // Let any (incorrect) lazy hydration fire and fail; the card must keep
    // exactly what it shows.
    await sleep(1500)
    assert.equal(
      requested.filter((url) => url.includes('/v2/gifs/stablecard01')).length,
      0,
      'a card that already has media must not fire a per-card detail request'
    )
    assert.equal(card.querySelector('.media-card__title')?.textContent, 'stabletag', 'card title must survive (no Loading… placeholder)')
    assert.equal(card.querySelector('img'), img, 'thumbnail element must not be replaced')
    assert.ok(!card.querySelector('.media-card__missing'), 'card must not collapse into the empty placeholder')
  } finally {
    window.close()
  }
})

// ---------------------------------------------------------------------------
// 2. A feed item with NO media hydrates once from the detail endpoint and the
//    result fills the card in — without the image ever being swapped again.
// ---------------------------------------------------------------------------
test('media-less feed items hydrate once and never swap/blink afterwards', async () => {
  const feedGif = {
    id: 'fillme01',
    userName: 'e2ecreator',
    duration: 12,
    views: 40,
    likes: 5,
    hasAudio: false,
    tags: ['hydratetag']
    // no urls at all — the search page gave this card nothing to show
  }
  const hydratedGif = {
    ...feedGif,
    likes: 321,
    urls: {
      hd: 'https://files.redgifs.com/FillMe01.mp4',
      sd: 'https://files.redgifs.com/FillMe01-mobile.mp4',
      poster: 'https://thumbs.redgifs.com/FillMe01-poster.jpg'
    }
  }

  const { window, requested } = await bootApp({
    route: '/',
    handleRequest: (url) => {
      if (url.includes('/api/redgifs/v2/auth/temporary')) return jsonResponse({ token: 'e2e-token' })
      if (url.includes('/v2/gifs/search')) return jsonResponse({ gifs: [feedGif], page: 1, pages: 1, total: 1 })
      if (url.includes('/v2/gifs/fillme01')) return jsonResponse({ gif: hydratedGif })
      return undefined
    }
  })

  try {
    const card = await waitFor(() => window.document.querySelector('.media-card'), 5000, 'media card')

    // Hydration fills the card in.
    const img = await waitFor(() => card.querySelector('img'), 5000, 'hydrated thumbnail')
    assert.match(img.getAttribute('src') ?? '', /FillMe01-poster\.jpg/)
    await waitFor(() => card.querySelector('.media-card__meta')?.textContent?.includes('321 likes'), 5000, 'hydrated like count')

    // Afterwards the card is at rest: exactly one detail request, same image.
    await sleep(1500)
    assert.equal(
      requested.filter((url) => url.includes('/v2/gifs/fillme01')).length,
      1,
      'detail hydration must be a single in-flight request, never a storm'
    )
    const imgAfter = card.querySelector('img')
    assert.equal(imgAfter, img, 'hydrated thumbnail must not be remounted')
    assert.equal(imgAfter?.getAttribute('src'), img.getAttribute('src'), 'thumbnail source must not be swapped (no blink)')
    assert.equal(window.document.querySelectorAll('.media-card').length, 1, 'still exactly one card')
  } finally {
    window.close()
  }
})

// ---------------------------------------------------------------------------
// 3. Premium items (pm-/hp- ids) render from their stored data — they must
//    never be replaced by an empty placeholder from the public-API path. This
//    boots the Library with one saved premium clip.
// ---------------------------------------------------------------------------
test('saved premium cards keep their media and never hit the public detail API', async () => {
  const premiumItem = {
    id: 'pm-e2e1',
    title: 'Saved premium clip',
    description: 'Saved premium clip',
    creator: 'premium',
    thumbnail: 'https://cdn.example.com/pm-one.jpg',
    thumbnailUrls: ['https://cdn.example.com/pm-one.jpg'],
    previewUrl: 'https://cdn.example.com/pm-one.mp4',
    videoUrl: 'https://cdn.example.com/pm-one.mp4',
    videoUrlSd: 'https://cdn.example.com/pm-one.mp4',
    sourceUrl: 'https://cdn.example.com/pm-one.mp4',
    duration: 9,
    likes: 3,
    views: 7,
    width: 720,
    height: 1280,
    createdAt: 0,
    hasAudio: true,
    tags: [],
    niches: []
  }

  const { window, requested } = await bootApp({
    route: '/library',
    storage: { 'x-sutra.saved.real.v2': JSON.stringify([premiumItem]) },
    handleRequest: () => undefined
  })

  try {
    const card = await waitFor(() => window.document.querySelector('.media-card'), 5000, 'premium media card')
    assert.equal(card.querySelector('.media-card__title')?.textContent, 'Saved premium clip')
    const img = await waitFor(() => card.querySelector('img'), 5000, 'premium thumbnail')
    assert.equal(img.getAttribute('src'), 'https://cdn.example.com/pm-one.jpg')

    // Give the old buggy hydration path every chance to fire; nothing may change.
    await sleep(1500)
    assert.equal(
      requested.filter((url) => url.includes('pm-e2e1')).length,
      0,
      'premium cards must never request the public detail endpoint'
    )
    assert.equal(card.querySelector('.media-card__title')?.textContent, 'Saved premium clip', 'premium card must not degrade to a placeholder')
    assert.equal(card.querySelector('img'), img, 'premium thumbnail must not be replaced')
    assert.ok(!card.querySelector('.media-card__missing'), 'premium card must not render the empty placeholder')
  } finally {
    window.close()
  }
})
