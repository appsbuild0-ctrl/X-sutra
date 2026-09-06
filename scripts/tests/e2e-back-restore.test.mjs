// End-to-end regression tests for "video kholne ke baad wapas wahi se aana
// chahiye" — the app-wide routing/restore complaint:
//
//   BEFORE: the video player sheet was NOT part of history. Pressing Back
//   with the sheet open left the whole screen (or exited the app), and the
//   screen you came from was unmounted — Search/tag/creator results and the
//   scroll position were gone, so returning started from the top. The home
//   feed additionally re-filtered the watched clip out of the grid the moment
//   the player opened, shifting everything up.
//
//   NOW: opening the player pushes a marker entry onto history (same path).
//   Back pops the marker and just closes the sheet — the screen underneath
//   stays mounted with its exact scroll. Bottom-nav taps replace (roots, not
//   stacked screens). The watched-clip filter only re-arms during reloads.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const bundlePath = path.join(root, '.cache', 'e2e', 'dist-back', 'app-iife.js')

async function buildAppBundle() {
  await mkdir(path.dirname(bundlePath), { recursive: true })
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    build: {
      outDir: path.join(root, '.cache', 'e2e', 'dist-back'),
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

function waitFor(check, timeoutMs = 8000, label = 'condition') {
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

const apiClip = {
  id: 'backclip01',
  userName: 'e2ecreator',
  duration: 14,
  views: 88,
  likes: 12,
  hasAudio: true,
  tags: ['backtag'],
  urls: {
    hd: 'https://files.redgifs.com/BackClip01.mp4',
    sd: 'https://files.redgifs.com/BackClip01-mobile.mp4',
    poster: 'https://thumbs.redgifs.com/BackClip01-poster.jpg'
  }
}

async function bootApp(route) {
  const bundle = await bundlePromise
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('error', () => undefined)

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `http://localhost/#${route}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  })
  const { window } = dom
  const scrollCalls = []
  window.scrollTo = (...args) => { scrollCalls.push(args) }

  window.fetch = async (input) => {
    let url = typeof input === 'string' ? input : String((input && input.url) ?? '')
    try { url = decodeURIComponent(url) } catch { /* keep raw */ }
    if (url.includes('/api/redgifs/v2/auth/temporary')) return jsonResponse({ token: 'e2e-token' })
    if (url.includes('/v2/gifs/search')) return jsonResponse({ gifs: [apiClip], page: 1, pages: 1, total: 1 })
    return notFound
  }

  try {
    window.eval(bundle)
    return { window, scrollCalls }
  } catch (error) {
    window.close()
    throw error
  }
}

function simulateScrollTo(window, y) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true })
  window.dispatchEvent(new window.Event('scroll'))
}

test('home: open a video, press Back, land exactly where you left (same grid, same scroll, card still there)', async () => {
  const { window, scrollCalls } = await bootApp('/')
  try {
    const firstCard = await waitFor(() => window.document.querySelector('.media-card'), 8000, 'feed card')
    const grid = firstCard.closest('.media-grid')
    assert.ok(firstCard && grid, 'feed card rendered')

    // User scrolled deep into the feed.
    simulateScrollTo(window, 620)
    const scrollCallsBeforeOpen = scrollCalls.length

    // Open the video.
    firstCard.querySelector('.media-card__visual').click()
    await waitFor(() => window.document.querySelector('.player'), 8000, 'player sheet')

    // Opening the player must NOT scroll the background (and not remount it).
    assert.equal(scrollCalls.length, scrollCallsBeforeOpen, 'no scroll jump when the player opens')
    assert.equal(window.document.querySelector('.media-grid'), grid, 'grid stays mounted behind the player')
    assert.ok(window.document.body.style.overflow === 'hidden', 'background scroll is locked while watching')

    // The watched filter must not yank the opened card mid-session.
    assert.ok(
      [...window.document.querySelectorAll('.media-card')].some((card) => card.textContent?.includes('backtag')),
      'the opened card stays in the grid during the session'
    )

    // Press Back (hardware / browser).
    window.history.back()
    await waitFor(() => !window.document.querySelector('.player'), 8000, 'player closed by Back')

    assert.equal(window.document.querySelector('.media-grid'), grid, 'same grid instance after Back — screen was never unmounted')
    const lastHomeScrollCall = scrollCalls.at(-1)?.[0]
    assert.equal(lastHomeScrollCall?.top, 620, `scroll restored to where the user left (got: ${JSON.stringify(lastHomeScrollCall)})`)
  } finally {
    window.close()
  }
})

test('search: opening a clip from results and pressing Back returns to the same results at the same scroll', async () => {
  const { window, scrollCalls } = await bootApp('/search/backtag')
  try {
    const firstCard = await waitFor(() => window.document.querySelector('.media-card'), 8000, 'search result card')
    const grid = firstCard.closest('.media-grid')
    assert.ok(firstCard && grid, 'search result card rendered')

    simulateScrollTo(window, 430)

    firstCard.querySelector('.media-card__visual').click()
    await waitFor(() => window.document.querySelector('.player'), 8000, 'player sheet')

    window.history.back()
    await waitFor(() => !window.document.querySelector('.player'), 8000, 'player closed by Back')

    assert.equal(window.document.querySelector('.media-grid'), grid, 'search results screen never unmounted')
    assert.equal(scrollCalls.at(-1)?.[0]?.top, 430, 'search scroll restored')
    assert.ok(
      window.location.hash.startsWith('#/search/backtag'),
      `still on the search route, not bounced home (hash: ${window.location.hash})`
    )
    // And the results themselves are untouched.
    assert.ok([...window.document.querySelectorAll('.media-card')].length >= 1, 'search results still rendered')
  } finally {
    window.close()
  }
})

test('bottom-nav tabs replace history instead of piling up; tapping the active tab scrolls to top', async () => {
  const { window, scrollCalls } = await bootApp('/')
  try {
    await waitFor(() => window.document.querySelector('.media-card'), 8000, 'home feed')
    const depthAtBoot = window.history.length

    const tabByLabel = (label) => [...window.document.querySelectorAll('.nav-tab')].find((tab) => tab.textContent?.includes(label))
    const discoverTab = tabByLabel('Discover')
    const homeTab = tabByLabel('Home')
    assert.ok(discoverTab && homeTab, 'bottom nav rendered')

    discoverTab.click()
    await waitFor(() => window.location.hash !== '#/', 8000, 'discover route')
    assert.equal(window.history.length, depthAtBoot, 'tab switch replaced the entry instead of pushing')

    homeTab.click()
    await waitFor(() => window.location.hash === '#/' || window.location.hash === '', 8000, 'home route')
    await waitFor(() => window.document.querySelector('.media-card'), 8000, 'home feed again')
    assert.equal(window.history.length, depthAtBoot, 'second tab switch also replaced')

    // Tapping the ACTIVE tab scrolls its screen to the top.
    scrollCalls.length = 0
    homeTab.click()
    await waitFor(() => scrollCalls.some((call) => call[0]?.top === 0 && call[0]?.behavior === 'smooth'), 5000, 'scroll-to-top on active tab tap')
  } finally {
    window.close()
  }
})
