import { loadConfig } from './config.mjs'
import { TelegramBot } from './telegram.mjs'
import { createStore } from './store.mjs'

let cached = null

/**
 * Lazily build the shared backend services from environment configuration.
 * Memoized so the store's write lock and bot client are reused across requests.
 */
export function getServices() {
  if (cached) return cached
  const config = loadConfig()
  const bot = new TelegramBot({
    token: config.token,
    chatId: config.chatId,
    apiBase: config.apiBase
  })
  const store = createStore(config)
  cached = { config, bot, store }
  return cached
}
