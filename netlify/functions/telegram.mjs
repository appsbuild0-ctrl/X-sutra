// X-sutra Premium Telegram bot.
// Webhook: POST /api/telegram
// Setup:   GET  /api/telegram?setup=1&password=admin123
// Notify:  POST /api/telegram?notify=1  (internal)
//
// Member: /start  /notify  /mute  /latest
// Admin:  /auth admin123   then send a video, a link, or
//         /post Title | https://video.mp4

import {
  addAdmin,
  addPost,
  adminPassword,
  json,
  readAdmins,
  readPosts,
  readSubscribers,
  writeSubscribers
} from './_premium-store.mjs'

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : ''

async function tg(method, payload) {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set on Netlify.')
  const response = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const data = await response.json()
  if (!data.ok) throw new Error(data.description || `Telegram ${method} failed`)
  return data.result
}

async function send(chatId, text, extra = {}) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra })
}

function extractUrl(text) {
  const match = String(text || '').match(/https?:\/\/[^\s<>"']+/i)
  return match ? match[0] : ''
}

async function notifySubscribers(post) {
  const subs = await readSubscribers()
  const text = [
    '✦ <b>New Premium clip</b>',
    post.title ? `<b>${escapeHtml(post.title)}</b>` : '',
    post.videoUrl
  ].filter(Boolean).join('\n')
  for (const chatId of subs) {
    try {
      await send(chatId, text)
    } catch {
      /* skip blocked chats */
    }
  }
  return subs.length
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function handleUpdate(update) {
  const message = update.message || update.edited_message
  if (!message) return
  const chatId = message.chat.id
  const text = String(message.text || message.caption || '').trim()
  const [command, ...rest] = text.split(/\s+/)
  const cmd = (command || '').split('@')[0].toLowerCase()
  const admins = await readAdmins()
  const isAdmin = admins.includes(String(chatId))

  if (cmd === '/start') {
    await send(chatId, [
      '<b>X-sutra Premium bot</b>',
      '',
      'Members:',
      '/notify — get new premium clips here',
      '/mute — stop notifications',
      '/latest — last 5 premium posts',
      '',
      'Admin:',
      '/auth admin123 — unlock publish',
      'Then send a video file, a direct link, or',
      '<code>/post Title | https://video.mp4</code>'
    ].join('\n'))
    return
  }

  if (cmd === '/notify') {
    const subs = await readSubscribers()
    if (!subs.includes(String(chatId))) subs.push(String(chatId))
    await writeSubscribers(subs)
    await send(chatId, 'Done. You will get new Premium clips in this chat.')
    return
  }

  if (cmd === '/mute') {
    const subs = (await readSubscribers()).filter((id) => id !== String(chatId))
    await writeSubscribers(subs)
    await send(chatId, 'Muted. Send /notify anytime to come back.')
    return
  }

  if (cmd === '/latest') {
    const posts = (await readPosts()).slice(0, 5)
    if (!posts.length) {
      await send(chatId, 'No premium clips yet.')
      return
    }
    await send(chatId, posts.map((post, i) => `${i + 1}. <b>${escapeHtml(post.title)}</b>\n${post.videoUrl}`).join('\n\n'))
    return
  }

  if (cmd === '/auth') {
    const password = rest.join(' ').trim()
    if (password !== adminPassword()) {
      await send(chatId, 'Wrong password.')
      return
    }
    await addAdmin(chatId)
    await send(chatId, 'Admin unlocked. Send a video, a link, or /post Title | https://...')
    return
  }

  if (cmd === '/post') {
    if (!isAdmin) {
      await send(chatId, 'Admin only. Send /auth first.')
      return
    }
    const raw = rest.join(' ')
    const [titlePart, urlPart] = raw.includes('|') ? raw.split('|') : ['', raw]
    const videoUrl = extractUrl(urlPart) || extractUrl(titlePart)
    try {
      const { post } = await addPost({ title: titlePart, videoUrl, source: 'telegram' })
      const n = await notifySubscribers(post)
      await send(chatId, `Published “${escapeHtml(post.title)}”. Notified ${n} member${n === 1 ? '' : 's'}.`)
    } catch (error) {
      await send(chatId, error instanceof Error ? error.message : 'Could not publish.')
    }
    return
  }

  if (!isAdmin) return

  const file = message.video || message.document
  if (file?.file_id && TOKEN) {
    try {
      const fileInfo = await tg('getFile', { file_id: file.file_id })
      const videoUrl = `https://api.telegram.org/file/bot${TOKEN}/${fileInfo.file_path}`
      const { post } = await addPost({
        title: text || file.file_name || 'Telegram clip',
        videoUrl,
        thumbnail: '',
        source: 'telegram-file'
      })
      const n = await notifySubscribers(post)
      await send(chatId, `Published “${escapeHtml(post.title)}”. Notified ${n} member${n === 1 ? '' : 's'}.`)
    } catch (error) {
      await send(chatId, error instanceof Error ? error.message : 'Could not fetch Telegram file.')
    }
    return
  }

  const videoUrl = extractUrl(text)
  if (videoUrl) {
    try {
      const title = text.replace(videoUrl, '').replace(/[|\-–—]/g, ' ').trim()
      const { post } = await addPost({ title, videoUrl, source: 'telegram' })
      const n = await notifySubscribers(post)
      await send(chatId, `Published “${escapeHtml(post.title)}”. Notified ${n} member${n === 1 ? '' : 's'}.`)
    } catch (error) {
      await send(chatId, error instanceof Error ? error.message : 'Could not publish.')
    }
  }
}

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET' && event.queryStringParameters?.setup === '1') {
      if ((event.queryStringParameters.password || '') !== adminPassword()) {
        return json(403, { error: 'Admin password required.' })
      }
      if (!TOKEN) return json(400, { error: 'Set TELEGRAM_BOT_TOKEN in Netlify env.' })
      const host = event.headers['x-forwarded-host'] || event.headers.host
      const proto = event.headers['x-forwarded-proto'] || 'https'
      const url = `${proto}://${host}/api/telegram`
      const result = await tg('setWebhook', { url, allowed_updates: ['message'] })
      return json(200, { ok: true, webhook: url, result })
    }

    if (event.httpMethod === 'POST' && event.queryStringParameters?.notify === '1') {
      if (event.headers['x-xsutra-notify'] !== adminPassword()) return json(403, { error: 'Forbidden' })
      const body = JSON.parse(event.body ?? '{}')
      if (!body.post) return json(400, { error: 'Missing post' })
      const n = await notifySubscribers(body.post)
      return json(200, { notified: n })
    }

    if (event.httpMethod === 'POST') {
      const update = JSON.parse(event.body ?? '{}')
      await handleUpdate(update)
      return json(200, { ok: true })
    }

    return json(200, {
      ok: true,
      bot: TOKEN ? 'configured' : 'missing TELEGRAM_BOT_TOKEN',
      hint: 'GET ?setup=1&password=admin123 to register the webhook after deploy.'
    })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Telegram bot error' })
  }
}
