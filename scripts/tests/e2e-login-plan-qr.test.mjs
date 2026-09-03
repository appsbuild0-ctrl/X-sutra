// End-to-end regression test for the login plan-cards → payment QR flow,
// run against the REAL app source (bundled by Vite exactly like production,
// as a single IIFE so jsdom can execute it):
//
//   1. Boot the app at #/login (signed out) with a seeded payment QR in
//      localStorage and no backend (every /api call 404s, like an on-device
//      APK without connectivity — plans fall back to their defaults).
//   2. Expect the plan cards to render on the LOGIN screen itself.
//   3. Tap the Premium card → the payment QR modal opens showing the SEEDED
//      QR (the correct one, not a stale/wrong image) and a countdown
//      formatted as m:ss — "1:59" for the 119s window, never "119s".
//   4. Tap CLOSE → the modal unmounts and the login form is right there
//      again (CLOSE always returns to login, never strands the user).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const bundlePath = path.join(root, '.cache', 'e2e', 'dist-plan-qr', 'app-iife.js')
const QR_DATA_URL = 'data:image/png;base64,iVBORw0KGgoSEEDQR'

async function buildAppBundle() {
  await mkdir(path.dirname(bundlePath), { recursive: true })
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    build: {
      outDir: path.join(root, '.cache', 'e2e', 'dist-plan-qr'),
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

test('login plan cards open the QR modal (correct QR + 1:59 countdown); CLOSE returns to login', async () => {
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
  // No backend in the test harness: every /api call gets a clean 404 so the
  // app falls back to its local-only data, like an on-device APK would.
  window.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' })
  // Seed the payment QR BEFORE the app boots so the modal must pick this one up.
  window.localStorage.setItem('x-sutra.pay.qr.v1', JSON.stringify(QR_DATA_URL))

  try {
    window.eval(bundle)

    // 1. The login form renders.
    await waitFor(() => window.document.querySelector('form.login-form'), 5000, 'login form')

    // 2. The plan cards render on the login screen itself.
    const cards = await waitFor(
      () => Array.from(window.document.querySelectorAll('.login-card .plan-grid .plan-card')),
      5000,
      'plan cards on login'
    )
    assert.ok(cards.length >= 1, 'at least one plan card is offered on the login screen')

    // 3. Tapping Premium opens the QR modal with the seeded QR + m:ss countdown.
    const premiumCard = cards.find((card) => /premium/i.test(card.textContent || ''))
    assert.ok(premiumCard, 'premium plan card exists')
    premiumCard.click()

    const modal = await waitFor(() => window.document.querySelector('.pay-modal'), 5000, 'payment QR modal')
    const qrImage = modal.querySelector('img')
    assert.ok(qrImage, 'QR image is shown in the modal')
    assert.equal(qrImage.getAttribute('src'), QR_DATA_URL, 'modal shows the seeded (correct) payment QR')

    const timer = modal.querySelector('.dl-gate__timer')
    assert.ok(timer, 'countdown is rendered')
    assert.equal(
      timer.textContent,
      'Payment expires in 1:59',
      'countdown uses the 1:59 m:ss format for the 119s window'
    )

    // 4. CLOSE unmounts the modal and lands back on the login form.
    const closeButton = Array.from(modal.querySelectorAll('button')).find((b) => /close/i.test(b.textContent || ''))
    assert.ok(closeButton, 'CLOSE button exists in the modal')
    closeButton.click()
    await waitFor(() => !window.document.querySelector('.pay-modal'), 5000, 'modal to close')
    assert.ok(window.document.querySelector('form.login-form'), 'CLOSE returns to the login screen')
  } finally {
    window.close()
  }
})
