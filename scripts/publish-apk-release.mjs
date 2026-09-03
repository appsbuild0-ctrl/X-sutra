#!/usr/bin/env node
/**
 * Best-effort publisher: pushes the freshly-built release APK to a stable,
 * public GitHub Release (`redgrab-apk`) so the APK has a permanent download
 * link that always points at the newest build:
 *
 *   https://github.com/<repo>/releases/download/redgrab-apk/redgrab-release.apk
 *
 * Runs only inside CI (needs GITHUB_TOKEN); any failure is non-fatal — the
 * normal artifact upload still happens. The release name and body carry the
 * build's versionCode/versionName so users can confirm they are not
 * reinstalling a stale build.
 */
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const repo = process.env.GITHUB_REPOSITORY || 'appsbuild0-ctrl/X-sutra'
const api = process.env.GITHUB_API_URL || 'https://api.github.com'
const TAG = 'redgrab-apk'
const ASSET = 'redgrab-release.apk'

if (!token) {
  console.log('[publish] no GITHUB_TOKEN — skipping release publish')
  process.exit(0)
}

const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
const apkPath = path.join(
  workspace,
  'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'
)

async function readVersion(): Promise<{ versionCode: string; versionName: string }> {
  const fallback = { versionCode: '', versionName: '' }
  try {
    const gradle = await readFile(path.join(workspace, 'android', 'app', 'build.gradle'), 'utf8')
    const versionCode = gradle.match(/versionCode\s+(\d+)/)?.[1] ?? ''
    const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1] ?? ''
    return { versionCode, versionName }
  } catch {
    return fallback
  }
}

try {
  await stat(apkPath)
} catch {
  console.log('[publish] APK not found at', apkPath, '— skipping')
  process.exit(0)
}

const { versionCode, versionName } = await readVersion()
const versionLabel = versionName ? `v${versionName}` : 'latest'
const versionDetail = [
  versionName ? `Version: ${versionName}` : '',
  versionCode ? `versionCode: ${versionCode}` : ''
].filter(Boolean).join('  ·  ')

const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'redgrab-apk-publisher'
}

// 1. Find or create the release.
let release
let res = await fetch(`${api}/repos/${repo}/releases/tags/${TAG}`, { headers })
if (res.status === 404) {
  res = await fetch(`${api}/repos/${repo}/releases`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      tag_name: TAG,
      name: `RedGrab APK ${versionLabel} (latest)`,
      body: `${versionDetail || 'Latest'} signed RedGrab APK. Download \`${ASSET}\` and open it on your phone (allow "install unknown apps").`,
      make_latest: 'true'
    })
  })
  if (!res.ok) throw new Error(`create release: ${res.status} ${await res.text()}`)
  release = await res.json()
} else if (res.ok) {
  release = await res.json()
  // Refresh the name/body so the version shown always matches the newest build.
  await fetch(`${api}/repos/${repo}/releases/${release.id}`, {
    method: 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `RedGrab APK ${versionLabel} (latest)`,
      body: `${versionDetail || 'Latest'} signed RedGrab APK. Download \`${ASSET}\` and open it on your phone (allow "install unknown apps").`
    })
  })
} else {
  throw new Error(`get release: ${res.status}`)
}

// 2. Remove a stale asset with the same name.
res = await fetch(`${api}/repos/${repo}/releases/${release.id}/assets`, { headers })
if (res.ok) {
  for (const asset of await res.json()) {
    if (asset.name === ASSET) {
      await fetch(`${api}/repos/${repo}/releases/assets/${asset.id}`, { method: 'DELETE', headers })
    }
  }
}

// 3. Upload the APK.
const uploadUrl = release.upload_url.replace('{?name,label}', '')
const bytes = await readFile(apkPath)
res = await fetch(`${uploadUrl}?name=${ASSET}`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/vnd.android.package-archive',
    'content-length': String(bytes.length),
    'user-agent': 'redgrab-apk-publisher'
  },
  body: bytes
})
if (!res.ok) throw new Error(`upload asset: ${res.status} ${await res.text()}`)
console.log(`[publish] APK ${versionLabel} published → https://github.com/${repo}/releases/download/${TAG}/${ASSET}`)
