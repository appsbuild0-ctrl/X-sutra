// /api/uploads — admin content uploads, stored in the existing Neon database.
//
// GET  → published upload metadata (role-filtered when a session is attached)
// POST → admin-only actions: start / chunk / finish / update / delete
//
// Every write requires an admin X-Sutra session; the role is re-checked against
// the database on each call, so hiding the button in the UI is never the only
// line of defence.

import { errorResponse, json } from './_server/security.mjs'
import { optionalRole, requireAdminUser } from './_server/users.mjs'
import {
  CHUNK_BYTES,
  deleteUpload,
  finishUpload,
  listCategories,
  listUploads,
  maxUploadBytes,
  startUpload,
  updateUpload,
  writeUploadChunk
} from './_server/uploads.mjs'

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const role = await optionalRole(event)
      return json(200, {
        uploads: await listUploads({ role }),
        categories: await listCategories(),
        limits: { chunkSize: CHUNK_BYTES, maxBytes: maxUploadBytes() }
      })
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

    const body = JSON.parse(event.body || '{}')
    const action = String(body.action || '')

    // Admin sees everything, including in-progress and unpublished uploads.
    if (action === 'list') {
      await requireAdminUser(event)
      return json(200, { uploads: await listUploads({ role: 'admin', includeHidden: true }), categories: await listCategories() })
    }

    if (action === 'start') {
      const session = await requireAdminUser(event)
      const started = await startUpload({
        title: body.title,
        category: body.category,
        thumbnail: body.thumbnail,
        contentType: body.contentType,
        filename: body.filename,
        size: body.size,
        accessRole: body.accessRole,
        published: body.published,
        ownerTelegramId: session.telegramId
      })
      return json(200, { ok: true, ...started })
    }

    if (action === 'chunk') {
      await requireAdminUser(event)
      const bytes = Buffer.from(String(body.data || ''), 'base64')
      return json(200, { ok: true, ...(await writeUploadChunk({ id: body.id, index: body.index, bytes })) })
    }

    if (action === 'finish') {
      await requireAdminUser(event)
      return json(200, { ok: true, upload: await finishUpload({ id: body.id, title: body.title, category: body.category, thumbnail: body.thumbnail }) })
    }

    if (action === 'update') {
      await requireAdminUser(event)
      return json(200, { ok: true, upload: await updateUpload(body) })
    }

    if (action === 'delete') {
      await requireAdminUser(event)
      return json(200, await deleteUpload(body.id))
    }

    return json(400, { error: 'Unknown action.' })
  } catch (error) {
    return errorResponse(error)
  }
}
