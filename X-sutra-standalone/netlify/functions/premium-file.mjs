import { adminPassword, json } from './_premium-store.mjs'
import { assembleChunks, readFileRecord, writeChunk, writeFileBytes } from './_premium-files.mjs'

function decodeBase64(data) {
  return Buffer.from(String(data || ''), 'base64')
}

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const id = event.queryStringParameters?.id || new URL(event.rawUrl || 'http://local/?id=').searchParams.get('id')
      const record = await readFileRecord(id)
      if (!record) return { statusCode: 404, body: 'Not found' }
      return {
        statusCode: 200,
        headers: {
          'Content-Type': record.contentType || 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000',
          'Content-Disposition': `inline; filename="${(record.filename || 'media').replace(/"/g, '')}"`
        },
        isBase64Encoded: true,
        body: Buffer.from(record.bytes).toString('base64')
      }
    }

    if (event.httpMethod !== 'POST') return json(405, { error: 'GET and POST only.' })
    const body = JSON.parse(event.body ?? '{}')
    if (body.password !== adminPassword()) return json(403, { error: 'Admin password required.' })
    const id = String(body.id || '').trim()
    if (!id) return json(400, { error: 'Missing file id.' })

    if (body.action === 'chunk') {
      await writeChunk(id, Number(body.index), decodeBase64(body.data))
      const done = Number(body.index) + 1 >= Number(body.total)
      let bytes = 0
      if (done) bytes = await assembleChunks(id, Number(body.total), body.contentType, body.filename)
      return json(200, { ok: true, id, done, bytes, url: `/api/premium-file?id=${encodeURIComponent(id)}` })
    }

    const bytes = decodeBase64(body.data)
    await writeFileBytes(id, bytes, body.contentType, body.filename)
    return json(200, { ok: true, id, bytes: bytes.length, url: `/api/premium-file?id=${encodeURIComponent(id)}` })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'File storage failed.' })
  }
}
