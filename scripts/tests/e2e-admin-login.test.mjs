// End-to-end regression test for the admin login flow, run against the REAL
// app source (bundled by Vite exactly like production, but as a single IIFE so
// jsdom can execute it):
//
//   1. Boot the app at #/login.
//   2. Type username "admin" + password "admin123" and submit the form.
//   3. Expect the router to land on #/admin and the full admin panel
//      (dashboard stats) to render.
//   4. Expect ZERO attempted whole-page navigations afterwards. Before the
//      fix, signing in as admin triggered the Discord auto-connect which
//      called window.location.assign('/api/discord/login?...') — on a phone
//      that blinked the whole app away to a dead page. jsdom reports any such
//      attempt as a "Not implemented: navigation" jsdomError, so counting them
//      is a direct blink detector.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const bundlePath = path.join(root, '.cache', 'e2e', 'dist', 'app-iife.js')

async function buildAppBundle() {
  await mkdir(path.dirname(bundlePath), { recursive: true })
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    build: {
      outDir: path.join(root, '.cache', 'e2e', 'dist'),
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

function setNativeValue(window, input, value) {
  const proto = Object.getPrototypeOf(input)
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter.call(input, value)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
}

test('admin / admin123 signs in, lands on the full admin panel, and never blinks the app away', async () => {
  const bundle = await buildAppBundle()

  const virtualConsole = new VirtualConsole()
  const navigations = []
  virtualConsole.on('jsdomError', (error) => {
    // jsdom raises "Not implemented: navigation (except hash changes)" for
    // any window.location.assign/replace/href write — exactly what the old
    // Discord auto-connect did right after admin login.
    if (/Not implemented: navigation/i.test(error.message)) navigations.push(error.message)
  })
  virtualConsole.on('error', () => undefined) // swallow app console.error noise

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/#/login',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  })
  const { window } = dom
  window.scrollTo = () => undefined
  // No backend in the test harness: every /api call gets a clean 404 so the
  // app falls back to its local-only data, like an on-device APK would.
  window.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' })

  try {
    window.eval(bundle)

    // 1. The login form renders.
    const form = await waitFor(() => window.document.querySelector('form.login-form'), 5000, 'login form')
    const [usernameInput, passwordInput] = [
      form.querySelector('input[autocomplete="username"]'),
      form.querySelector('input[autocomplete="current-password"]')
    ]
    assert.ok(usernameInput, 'username field exists on the login page')
    assert.ok(passwordInput, 'password field exists on the login page')

    // 2. Type admin / admin123 and submit.
    setNativeValue(window, usernameInput, 'admin')
    setNativeValue(window, passwordInput, 'admin123')
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))

    // 3. Router must land on #/admin with the dashboard rendered.
    await waitFor(() => window.location.hash === '#/admin', 5000, 'hash to become #/admin')
    const stats = await waitFor(
      () => window.document.querySelector('.screen--admin .admin-stats'),
      5000,
      'admin dashboard stats'
    )
    const statLabels = Array.from(stats.querySelectorAll('span')).map((node) => node.textContent)
    assert.deepEqual(statLabels.slice(0, 4), ['Total Users', 'Premium', 'VIP', 'Videos'])
    const tabs = Array.from(window.document.querySelectorAll('.admin-tabs button')).map((node) => node.textContent)
    assert.deepEqual(tabs, ['Dashboard', 'Users', 'Videos', 'Notifications', 'Settings'])

    // The admin session must persist (readSession round-trip) so a refresh stays signed in.
    const session = JSON.parse(window.localStorage.getItem('x-sutra.session.local.v1'))
    assert.equal(session.username, 'admin')
    assert.equal(session.role, 'admin')

    // 4. Give the Discord auto-connect effect time to (wrongly) fire; it must not.
    await new Promise((resolve) => setTimeout(resolve, 800))
    assert.deepEqual(
      navigations,
      [],
      'no whole-page navigation after admin login (the old Discord auto-redirect blink)'
    )
  } finally {
    // Always stop jsdom's timers so the test process exits even on failure.
    window.close()
  }
})
