const V2 = 'https://api.redgifs.com/v2'

// Header fingerprints to compare: which one makes RedGifs return clean URLs?
const COMBOS = {
  chrome_redgifs_site: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Referer: 'https://www.redgifs.com/',
    Origin: 'https://www.redgifs.com'
  },
  downloader_ua_only: {
    'User-Agent': 'RedGifs-Downloader/4.0'
  },
  plain_node_default: {}
}

async function run() {
  for (const [name, extraHeaders] of Object.entries(COMBOS)) {
    try {
      const base = { Accept: 'application/json', ...extraHeaders }
      const tokenResponse = await fetch(`${V2}/auth/temporary`, { headers: base })
      const tokenData = await tokenResponse.json().catch(() => ({}))
      if (!tokenData.token) {
        console.log(`\n[${name}] token FAILED (${tokenResponse.status})`)
        continue
      }
      console.log(`\n===== [${name}] token OK =====`)
      console.log('request headers:', JSON.stringify(base))

      const feedResponse = await fetch(`${V2}/gifs/search?count=2&order=latest`, {
        headers: { ...base, Authorization: `Bearer ${tokenData.token}` }
      })
      const feed = await feedResponse.json().catch(() => ({}))
      const first = feed.gifs?.[0]
      console.log(`[feed ${feedResponse.status}] first gif urls:`)
      console.log(JSON.stringify(first?.urls ?? null, null, 1))

      if (first?.id) {
        const detailResponse = await fetch(`${V2}/gifs/${first.id}`, {
          headers: { ...base, Authorization: `Bearer ${tokenData.token}` }
        })
        const detail = await detailResponse.json().catch(() => ({}))
        console.log(`[detail ${detailResponse.status}] urls:`)
        console.log(JSON.stringify(detail.gif?.urls ?? null, null, 1))
      }
    } catch (error) {
      console.log(`\n[${name}] ERROR: ${error.message}`)
    }
  }
}

run().then(() => console.log('\ndone'))
