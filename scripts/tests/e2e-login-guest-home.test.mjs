// End-to-end regression test for the guest entry point, run against the REAL
// app source (bundled by Vite exactly like production, as a single IIFE so
// jsdom can execute it):
//
//   1. Boot the app at #/login (signed out, no backend).
//   2. Expect the guest arrow to sit at the TOP of the login card — above
//      the brand mark and the sign-in form — not as a footnote link below.
//   3. Tap it → the router lands on '#' (the homepage feed) and the home
//      screen renders, without creating any account.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const bundlePath = path.join(root, '.cache', 'e2e', 'dist-guest', 'app-iife.js')

async function buildAppBundle() {
  await mkdir(path.dirname(bundlePath), { recursive: true })
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    build: {
      outDir: path.join(root, '.cache', 'e2e', 'dist-guest'),
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

test('guest arrow sits at the top of login and navigates straight to the homepage', async () => {
  const bundle = await buildAppBundle()

  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', () => undefined)
  virtualConsole.on('error', () => undefined)

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/#/login',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  })
  const { window } = dom
  window.scrollTo = () => undefined
  window.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' })

  try {
    window.eval(bundle)

    // 1. Login renders, and the guest arrow is present.
    const arrow = await waitFor(() => window.document.querySelector('.login-guest-arrow'), 5000, 'guest arrow')
    assert.match(arrow.textContent || '', /guest/i, 'arrow is labelled as the guest entry')

    // 2. It must be at the TOP: the first element inside the login card,
    //    above the form (which follows it in document order).
    const card = window.document.querySelector('.login-card')
    const form = window.document.querySelector('form.login-form')
    assert.ok(card && form, 'login card and form exist')
    assert.equal(card.firstElementChild, arrow, 'guest arrow is the first element at the top of the login card')
    const follows = (arrow.compareDocumentPosition(form) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    assert.ok(follows, 'guest arrow sits above the sign-in form')

    // 3. Tapping it navigates to the homepage feed.
    arrow.click()
    await waitFor(() => window.location.hash === '#/', 5000, 'hash to become #/')
    await waitFor(() => window.document.querySelector('.screen--home'), 5000, 'home screen to render')
    assert.ok(!window.document.querySelector('form.login-form'), 'login form is gone after entering as guest')
  } finally {
    window.close()
  }
})
