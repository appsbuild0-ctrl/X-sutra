// /api/uploads — admin content uploads (Vercel filesystem route).
import { handler as uploads } from '../netlify/functions/uploads.mjs'
import { runHandler } from '../netlify/functions/_server/vercel.mjs'

export default async function vercelUploads(req, res) {
  await runHandler(uploads, req, res)
}
