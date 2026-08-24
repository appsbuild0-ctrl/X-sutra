import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const MB = 1024 * 1024

/**
 * Telegram Bot API documented upload limits (multipart/form-data).
 * Photos: 10 MB. Videos / animations / documents: 50 MB.
 * Source: https://core.telegram.org/bots/api#sending-files
 *
 * The standard public Bot API caps bot *downloads* (getFile) at 20 MB.
 * Files larger than that cannot be streamed back through the public API;
 * a self-hosted Local Bot API Server (TELEGRAM_API_BASE pointed at it) lifts
 * this to ~2 GB. We enforce the upload limits here and surface a clear error
 * when retrieval would exceed the download ceiling.
 */
export const TELEGRAM_LIMITS = {
  image: 10 * MB,
  video: 50 * MB,
  file: 50 * MB
}

export const TELEGRAM_RETRIEVAL_LIMIT = 20 * MB

function defaultDataDir() {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, 'data')
}

export function loadConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? ''
  const chatId = process.env.TELEGRAM_STORAGE_CHAT_ID ?? ''
  const apiBase = (process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org').replace(/\/+$/, '')
  const adminPassword = process.env.ADMIN_PASSWORD ?? ''
  const sessionSecret = process.env.ADMIN_SESSION_SECRET ?? ''
  const dataDir = process.env.XSUTRA_DATA_DIR ?? defaultDataDir()
  const sessionTtl = Number(process.env.ADMIN_SESSION_TTL_MS ?? 7 * 24 * 60 * 60 * 1000)
  return { token, chatId, apiBase, adminPassword, sessionSecret, dataDir, sessionTtl }
}

/** Hard ceiling on the buffered request body (upload). Slightly above the 50 MB video cap. */
export const MAX_REQUEST_BODY = 60 * MB
