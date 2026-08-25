import { db, ensureSchema } from './_server/database.mjs'
import { json, requireRole, safeError } from './_server/security.mjs'

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' })
    const user = await requireRole(event, ['premium', 'vip', 'admin'])
    await ensureSchema()
    const role = user.role === 'admin' ? 'vip' : user.role
    const rows = await db()`select c.id,c.title,c.avatar,c.category,c.access_role,c.updated_at,count(m.id)::int media_count,max(m.created_at) latest_at from xs_channels c left join xs_media m on m.channel_id=c.id and m.published=true where c.published=true and (c.access_role='premium' or ${role} in ('vip')) group by c.id order by max(m.created_at) desc nulls last limit 50`
    return json(200, { channels: rows })
  } catch (error) { return safeError(error) }
}
