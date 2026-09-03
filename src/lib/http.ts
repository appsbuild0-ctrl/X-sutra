// Shared HTTP helper for the app's own JSON API (/api/...).
//
// The API proxy rate-limits bursts with HTTP 429 — the old client treated that
// as a hard failure (or silently fell back to stale local data) even though a
// short retry would have succeeded. fetchWithRetry retries ONLY 429 responses,
// with exponential backoff + jitter, honouring a numeric Retry-After header
// when the server sends one. Every other status (including other 4xx/5xx) is
// returned immediately, unchanged.

export interface FetchRetryOptions {
  retries: number
  baseDelayMs: number
  maxDelayMs: number
}

const DEFAULTS: FetchRetryOptions = { retries: 3, baseDelayMs: 700, maxDelayMs: 6000 }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function delayFor(attempt: number, retryAfter: string | null, options: FetchRetryOptions): number {
  const headerSeconds = retryAfter === null ? Number.NaN : Number(retryAfter)
  if (Number.isFinite(headerSeconds) && headerSeconds >= 0) {
    return Math.min(headerSeconds * 1000, options.maxDelayMs)
  }
  const exponential = options.baseDelayMs * 2 ** attempt
  const jitter = Math.random() * 250
  return Math.min(exponential + jitter, options.maxDelayMs)
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  overrides?: Partial<FetchRetryOptions>
): Promise<Response> {
  const options: FetchRetryOptions = { ...DEFAULTS, ...overrides }
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, init)
    if (response.status !== 429 || attempt >= options.retries) return response
    await sleep(delayFor(attempt, response.headers.get('retry-after'), options))
  }
}
