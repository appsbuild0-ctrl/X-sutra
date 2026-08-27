// /api/channels — Telegram source channels, managed by admins.
//
// GET  → published channel names (metadata only)
// POST → admin-only: list (all), create, update, delete
//
// The owner's channel is seeded automatically; admins create/delete the rest.
// Every write is authorised against the database, never just the UI.

import { errorResponse, json } from './_server/security.mjs'
import { requireAdminUser, optionalRole } from './_server/users.mjs'
import {
  createChannel,
  deleteChannel,
  listChannels,
  seedDefaultChannels,
  updateChannel
} from './_server/channels.mjs'

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      await optionalRole(event)
      return json(200, { channels: await listChannels() })
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

    const body = JSON.parse(event.body || '{}')
    const action = String(body.action || '')

    if (action === 'list') {
      await requireAdminUser(event)
      return json(200, { channels: await listChannels({ includeHidden: true }) })
    }
    if (action === 'create') {
      await requireAdminUser(event)
      return json(200, { ok: true, channels: await createChannel(body) })
    }
    if (action === 'update') {
      await requireAdminUser(event)
      return json(200, { ok: true, channel: await updateChannel(body) })
    }
    if (action === 'delete') {
      await requireAdminUser(event)
      return json(200, await deleteChannel(body.id))
    }

    return json(400, { error: 'Unknown action.' })
  } catch (error) {
    return errorResponse(error)
  }
}
