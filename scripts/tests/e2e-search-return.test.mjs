// End-to-end test of the EXACT user story, no shortcuts:
//
//   Home → Discover tab → type a query into the search box → submit →
//   scroll deep into the results → click a video → watch → press Back →
//   land back in the SAME search results at the SAME scroll position.
//
// This mirrors the complaint "search me video kholke back dabaaya toh upar se
// nahi aana chahiye — jahan tha wahi se shuru ho". Any query text works; the
// restoration is query-agnostic, so one narrative run pins the mechanism.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const bundlePath = path.join(root, '.cache', 'e2e', 'dist-searchreturn', 'app-iife.js')

async function buildAppBundle() {
  await mkdir(path.dirname(bundlePath), { recursive: true })
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    build: {
      outDir: path.join(root, '.cache', 'e2e', 'dist-searchreturn'),
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
  id: 'searchstory1',
  userName: 'e2ecreator',
  duration: 16,
  views: 99,
  likes: 21,
  hasAudio: true,
  tags: ['storytag'],
  urls: {
    hd: 'https://files.redgifs.com/SearchStory1.mp4',
    sd: 'https://files.redgifs.com/SearchStory1-mobile.mp4',
    poster: 'https://thumbs.redgifs.com/SearchStory1-poster.jpg'
  }
}

test('search story: type a query, scroll deep, open a video, press Back — resume at the exact spot', async () => {
  const bundle = await buildAppBundle()
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('error', () => undefined)

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/#/',
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

    // 1. Home loads.
    await waitFor(() => window.document.querySelector('.media-card'), 8000, 'home feed')

    // 2. Tap the Discover tab like a user would.
    const discoverTab = [...window.document.querySelectorAll('.nav-tab')].find((tab) => tab.textContent?.includes('Discover'))
    assert.ok(discoverTab, 'discover tab present')
    discoverTab.click()
    await waitFor(() => window.document.querySelector('.search-field'), 8000, 'discover screen with search box')

    // 3. Type a query into the search box (React-controlled input) and submit.
    const form = window.document.querySelector('.search-field')
    const input = form.querySelector('input')
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    valueSetter.call(input, 'storytag')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))

    // 4. Results appear.
    const resultCard = await waitFor(() => window.document.querySelector('.media-card'), 8000, 'search results')
    const resultsGrid = resultCard.closest('.media-grid')
    assert.ok(window.location.hash.includes('/search/storytag'), `on the search route (hash: ${window.location.hash})`)

    // 5. User scrolls deep into the results.
    Object.defineProperty(window, 'scrollY', { value: 2500, configurable: true, writable: true })
    window.dispatchEvent(new window.Event('scroll'))

    // 6. Click the video.
    resultCard.querySelector('.media-card__visual').click()
    await waitFor(() => window.document.querySelector('.player'), 8000, 'player sheet')

    // 7. Hardware/browser Back.
    window.history.back()
    await waitFor(() => !window.document.querySelector('.player'), 8000, 'player closed by Back')

    // 8. EXACT resume: same results screen instance, same scroll, same query.
    assert.equal(window.document.querySelector('.media-grid'), resultsGrid, 'search screen was never unmounted — identical grid DOM node')
    assert.equal(scrollCalls.at(-1)?.[0]?.top, 2500, `scroll restored to the exact position (got: ${JSON.stringify(scrollCalls.at(-1)?.[0])})`)
    assert.ok(window.location.hash.includes('/search/storytag'), `still on the search route (hash: ${window.location.hash})`)
    assert.ok(
      [...window.document.querySelectorAll('.media-card')].some((card) => card.textContent?.includes('storytag')),
      'the original results are still there'
    )

    // 9. One more Back leaves search and lands on Discover (its kept copy).
    window.history.back()
    await waitFor(() => window.location.hash.includes('/discover'), 8000, 'discover route after second Back')
    assert.ok(window.document.querySelector('.search-field'), 'discover screen restored')
  } finally {
    window.close()
  }
})
