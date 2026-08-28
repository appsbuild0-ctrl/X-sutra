import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Tiered API access for the Drop build:
// 1. The bundled Netlify Function answers /api/redgifs with the app
//    User-Agent, which is what returns clean (non-watermarked) media URLs.
//    It runs wherever functions are supported (git-connected or Drop sites
//    that deploy the netlify/functions folder).
// 2. Static-only deployments fall through to the same-origin 200 rewrite,
//    so feeds keep working even without functions (browser UA is forwarded,
//    which may bring watermarked URLs back — the app switches automatically).
const redirects = `# Tier 1: bundled function proxy with the app User-Agent.
/api/redgifs  /.netlify/functions/redgifs  200
# Clean media files stream through the same-origin media proxy.
/api/media  /.netlify/functions/media  200
# Premium posts list (shared via Netlify Blobs).
/api/premium  /.netlify/functions/premium  200
/api/premium-scan  /.netlify/functions/premium-scan  200
/api/premium-file  /.netlify/functions/premium-file  200
/api/hotpic  /.netlify/functions/hotpic  200
# Discord bot integration (server-side only — bot token never exposed).
/api/discord/health  /.netlify/functions/discord-health  200
/api/discord/upload  /.netlify/functions/discord-upload  200
/api/discord/delete  /.netlify/functions/discord-delete  200
# Real channel import: messages, images and videos stored with their channel.
/api/discord/sync  /.netlify/functions/discord-sync  200
# Premium media feed + attachment URL resolver (302 to the Discord CDN).
/api/discord/feed  /.netlify/functions/discord-feed  200
/api/discord/media  /.netlify/functions/discord-media  200
# Drop sites often have no functions — proxy public Hotpic HTML same-origin.
/api/hotpic-html/*  https://hotpic.vip/:splat  200!
# Tier 2: static rewrite fallback for deployments without functions.
/api/redgifs/*  https://api.redgifs.com/:splat  200!
# Hash routing is used by RedGrab, but this keeps any future direct paths safe.
/*  /index.html  200
`

await mkdir('dist-drop/netlify/functions', { recursive: true })
await writeFile('dist-drop/_redirects', redirects, 'utf8')
for (const file of (await readdir('netlify/functions')).filter((name) => name.endsWith('.mjs'))) {
  await copyFile(resolve('netlify/functions', file), resolve('dist-drop/netlify/functions', file))
}
await rm('dist-drop/_api-note', { force: true })
console.log('Drop build bundles the tiered API proxy (function + rewrite fallback).')
