// Unit tests for the shared API fetch helper's 429 retry behaviour.
// A burst-limited /api must not surface as a hard failure: only 429 is
// retried (with backoff), everything else — including other 4xx — passes
// straight through so the app's local fallbacks keep working untouched.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fetchWithRetry } from '../../src/lib/http.ts'

const fast = { retries: 3, baseDelayMs: 1, maxDelayMs: 4 }

function fakeFetch(statuses, { headers } = {}) {
  let calls = 0
  const handler = async () => {
    const status = statuses[Math.min(calls, statuses.length - 1)]
    calls += 1
    return new Response(JSON.stringify({ ok: status < 400 }), {
      status,
      headers: status === 429 ? headers : undefined
    })
  }
  handler.callCount = () => calls
  return handler
}

test('retries 429 responses and returns the first success', async () => {
  const original = globalThis.fetch
  const fetchMock = fakeFetch([429, 429, 200])
  globalThis.fetch = fetchMock
  try {
    const response = await fetchWithRetry('/api/premium', undefined, fast)
    assert.equal(response.status, 200)
    assert.equal(fetchMock.callCount(), 3)
  } finally {
    globalThis.fetch = original
  }
})

test('gives up after the configured retries and returns the 429 response', async () => {
  const original = globalThis.fetch
  const fetchMock = fakeFetch([429])
  globalThis.fetch = fetchMock
  try {
    const response = await fetchWithRetry('/api/premium', undefined, { retries: 2, baseDelayMs: 1, maxDelayMs: 4 })
    assert.equal(response.status, 429)
    assert.equal(fetchMock.callCount(), 3) // 1 attempt + 2 retries
  } finally {
    globalThis.fetch = original
  }
})

test('non-429 statuses are never retried (local fallbacks still kick in immediately)', async () => {
  const original = globalThis.fetch
  const fetchMock = fakeFetch([404])
  globalThis.fetch = fetchMock
  try {
    const response = await fetchWithRetry('/api/premium', undefined, fast)
    assert.equal(response.status, 404)
    assert.equal(fetchMock.callCount(), 1)
  } finally {
    globalThis.fetch = original
  }
})

test('a numeric Retry-After header overrides the exponential backoff', async () => {
  const original = globalThis.fetch
  // Backoff would wait ~10s; Retry-After: 0 must make the retry immediate.
  const fetchMock = fakeFetch([429, 200], { headers: { 'retry-after': '0' } })
  globalThis.fetch = fetchMock
  try {
    const started = Date.now()
    const response = await fetchWithRetry('/api/premium', undefined, { retries: 3, baseDelayMs: 10_000, maxDelayMs: 20_000 })
    const elapsed = Date.now() - started
    assert.equal(response.status, 200)
    assert.equal(fetchMock.callCount(), 2)
    assert.ok(elapsed < 1_000, `retry should be immediate, took ${elapsed}ms`)
  } finally {
    globalThis.fetch = original
  }
})
