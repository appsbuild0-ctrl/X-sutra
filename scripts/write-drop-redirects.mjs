import { mkdir, writeFile } from 'node:fs/promises'

const redirects = `# Netlify Drop static build: proxy public source API through this site.
/api/redgifs/*  https://api.redgifs.com/:splat  200!
# Hash routing is used by X-sutra, but this keeps any future direct paths safe.
/*  /index.html  200
`

await mkdir('dist-drop', { recursive: true })
await writeFile('dist-drop/_redirects', redirects, 'utf8')
