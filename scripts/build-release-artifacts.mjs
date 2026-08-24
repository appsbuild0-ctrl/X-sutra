import { execFile } from 'node:child_process'
import { mkdir, copyFile, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const run = promisify(execFile)
const root = process.cwd()
const dropDirectory = resolve(root, 'dist-drop')
const standaloneDirectory = resolve(root, 'X-sutra-standalone')
const zipPath = resolve(root, 'X-sutra-netlify-drop.zip')

// Fail early when this script is run without the production Drop build that
// package.json intentionally creates first.
await readFile(resolve(dropDirectory, 'index.html'), 'utf8')

const result = await build({
  entryPoints: [resolve(root, 'src/main.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  charset: 'utf8',
  legalComments: 'eof',
  define: { 'import.meta.env.MODE': JSON.stringify('drop') },
  outdir: resolve(root, '.inline-release'),
  entryNames: 'x-sutra',
  write: false
})

const javascript = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text
const stylesheet = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text
if (!javascript || !stylesheet) throw new Error('The standalone JavaScript/CSS bundle was not generated')

const safeJavascript = javascript.replace(/<\/script/gi, '<\\/script')
const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/><meta name="theme-color" content="#100d0e"/><meta name="description" content="X-sutra standalone public-media browser"/><title>X-sutra</title><style>${stylesheet}</style></head><body><div id="root"></div><script>${safeJavascript}</script></body></html>
`

await mkdir(standaloneDirectory, { recursive: true })
await writeFile(resolve(standaloneDirectory, 'index.html'), html, 'utf8')
await mkdir(resolve(standaloneDirectory, 'netlify/functions'), { recursive: true })
for (const file of (await readdir('netlify/functions')).filter((name) => name.endsWith('.mjs'))) {
  await copyFile(resolve('netlify/functions', file), resolve(standaloneDirectory, 'netlify/functions', file))
}
await writeFile(
  resolve(standaloneDirectory, '_redirects'),
  [
    '# Tier 1: bundled function proxy with the app User-Agent.',
    '/api/redgifs  /.netlify/functions/redgifs  200',
    '/api/media  /.netlify/functions/media  200',
    '/api/premium  /.netlify/functions/premium  200',
    '/api/premium-scan  /.netlify/functions/premium-scan  200',
    '/api/premium-file  /.netlify/functions/premium-file  200',
    '# Tier 2: static rewrite fallback for deployments without functions.',
    '/api/redgifs/*  https://api.redgifs.com/:splat  200!',
    '/*  /index.html  200',
    ''
  ].join('\n'),
  'utf8'
)

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  }))
  return nested.flat()
}

// The tracked ZIP is the complete static Drop output, not a renamed HTML file.
// Normalize file times and ordering so CI can prove the committed archive was
// built from this source rather than reporting a timestamp-only binary diff.
const dropFiles = (await filesBelow(dropDirectory)).sort()
const archiveTime = new Date('2000-01-01T00:00:00.000Z')
await Promise.all(dropFiles.map((file) => utimes(file, archiveTime, archiveTime)))
const archiveEntries = dropFiles.map((file) => relative(dropDirectory, file))
await rm(zipPath, { force: true })
try {
  await run('zip', ['-X', '-q', zipPath, ...archiveEntries], {
    cwd: dropDirectory,
    env: { ...process.env, TZ: 'UTC' }
  })
} catch (error) {
  throw new Error(`Could not create ${zipPath}. Install the standard "zip" command and retry.`, { cause: error })
}

console.log('Updated X-sutra-standalone/index.html and X-sutra-netlify-drop.zip')
