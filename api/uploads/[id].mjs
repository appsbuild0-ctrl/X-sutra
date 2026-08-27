// /api/uploads/:id — streams an uploaded file back out of PostgreSQL.
// Vercel passes the dynamic segment in req.query.id.
import { handler as uploadFile } from '../../netlify/functions/upload-file.mjs'
import { runHandler } from '../../netlify/functions/_server/vercel.mjs'

export default async function vercelUploadFile(req, res) {
  await runHandler(uploadFile, req, res, { readBody: false })
}
