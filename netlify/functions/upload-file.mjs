// /api/uploads/<id> — serves an uploaded file back out of PostgreSQL.
//
// Range requests are answered properly (206 + Content-Range) so the existing
// X-Sutra video player can seek, and each response is capped to one chunk's
// worth of bytes so a function never has to return a whole video at once.

import { errorResponse, json } from './_server/security.mjs'
import { canSee, getUploadMeta, readUploadRange } from './_server/uploads.mjs'
import { optionalRole } from './_server/users.mjs'

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' })

    const id = String(
      event.pathParameters?.id
        || event.queryStringParameters?.id
        || new URL(event.rawUrl || 'http://local/?id=').searchParams.get('id')
        || ''
    ).trim()
    if (!id) return json(400, { error: 'Missing upload id.' })

    // Non-public uploads need a session with matching access.
    const upload = await getUploadMeta(id)
    if (!upload) return json(404, { error: 'That upload does not exist.' })
    if (upload.access_role !== 'public' || !upload.published) {
      const role = await optionalRole(event)
      if (!canSee(String(upload.access_role), role) || (!upload.published && role !== 'admin')) {
        return json(403, { error: 'This upload is for members only — sign in with a Premium, VIP or admin account.' })
      }
    }

    const result = await readUploadRange(id, event.headers?.range || event.headers?.Range || '')
    return {
      statusCode: result.status,
      headers: { ...result.headers, 'content-length': String(result.body.length) },
      isBase64Encoded: true,
      body: result.body.toString('base64')
    }
  } catch (error) {
    return errorResponse(error)
  }
}
