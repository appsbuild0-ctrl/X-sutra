// Streaming media proxy (Netlify Functions v1 handler — same proven runtime
// as redgifs.mjs). media.redgifs.com refuses referer-less/foreign requests
// with 403, so the clean permanent files are streamed through this
// same-origin endpoint with the header fingerprints that are accepted.
//
// Range handling: video players fetch media in range chunks; every response
// is capped so the function stays under the platform body-size limit, and a
// response without Content-Range of the full size is a valid partial that
// makes the player keep issuing ranges.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const BASE = 'https://media.redgifs.com'
const MAX_BYTES = 5 * 1024 * 1024 // 5MB per response
const FINGERPRINTS = [
  { Referer: 'https://getredgifs.com/' },
  { Referer: 'https://www.redgifs.com/' },
  { Referer: 'https://media.redgifs.com/' },
  {}
]

function jsonResponse(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Only GET requests are supported.' })

  const name = event.queryStringParameters?.name ?? ''
  if (!/^[A-Za-z0-9_-]+\.(?:mp4|webm|m4s|jpe?g|png)$/i.test(name)) {
    return jsonResponse(400, { error: 'Unsupported media name.' })
  }

  // Build a bounded Range: serve the requested slice, capped to MAX_BYTES;
  // range-less requests get the first slice so players switch to ranges.
  let range = event.headers?.range ?? ''
  const match = range.match(/^bytes=(\d*)-(\d*)$/)
  const start = match && match[1] ? Number(match[1]) : 0
  const requestedEnd = match && match[2] ? Number(match[2]) : start + MAX_BYTES - 1
  const end = Math.min(requestedEnd, start + MAX_BYTES - 1)
  range = `bytes=${start}-${end}`

  let lastStatus = 0
  let lastReferer = ''
  const debug = event.queryStringParameters?.debug === '1'
  for (const fingerprint of FINGERPRINTS) {
    try {
      const upstream = await fetch(`${BASE}/${name}`, {
        headers: { 'User-Agent': UA, ...fingerprint, Range: range }
      })
      lastStatus = upstream.status
      lastReferer = fingerprint.Referer ?? '(none)'
      if (debug) {
        const buffer = Buffer.from(await upstream.arrayBuffer())
        return jsonResponse(200, {
          upstreamStatus: upstream.status,
          referer: lastReferer,
          contentType: upstream.headers.get('content-type'),
          contentRange: upstream.headers.get('content-range'),
          bytes: buffer.length,
          firstBytes: buffer.subarray(0, 16).toString('hex')
        })
      }
      if (upstream.status !== 200 && upstream.status !== 206) continue

      const buffer = Buffer.from(await upstream.arrayBuffer())
      // No manual Content-Length: the platform computes it and a manual value
      // on a base64-encoded body can break response serialization (500).
      const headers = {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'Content-Range': upstream.headers.get('content-range') ?? `bytes ${start}-${start + buffer.length - 1}/*`
      }
      return { statusCode: upstream.status, headers, body: buffer.toString('base64'), isBase64Encoded: true }
    } catch {
      // try the next fingerprint
    }
  }
  return jsonResponse(404, { error: 'Media unavailable through the proxy.', lastStatus })
}
