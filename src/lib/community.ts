/**
 * Community data layer — localStorage-backed Discord-style community system.
 * Follows the same persistence pattern as the existing RedGrab app.
 */

import { readStored, writeStored } from './storage'

// ─── Types ───

export type CommunityRole = 'owner' | 'admin' | 'moderator' | 'premium' | 'vip' | 'member'

export interface CommunityMember {
  username: string
  name: string
  role: CommunityRole
  joinedAt: string
  status: 'on' | 'off'
}

export interface ChannelPermission {
  view: CommunityRole[]
  send: CommunityRole[]
  upload: CommunityRole[]
}

export interface CommunityCategory {
  id: string
  name: string
  collapsed: boolean
  order: number
}

export interface CommunityChannel {
  id: string
  categoryId: string
  name: string
  description: string
  emoji: string
  type: 'text' | 'media'
  permissions: ChannelPermission
  premiumOnly: boolean
  order: number
  createdAt: string
  lastMessageAt?: string
  unreadCount: number
}

export interface MessageAttachment {
  id: string
  type: 'image' | 'video' | 'file'
  url: string
  name: string
  size: number
  mimeType: string
  width?: number
  height?: number
  duration?: number
}

export interface MessageReaction {
  emoji: string
  users: string[]
}

export interface CommunityMessage {
  id: string
  channelId: string
  author: string
  authorName: string
  authorRole: CommunityRole
  content: string
  attachments: MessageAttachment[]
  replyTo?: string
  replyToContent?: string
  replyToAuthor?: string
  reactions: MessageReaction[]
  pinned: boolean
  edited: boolean
  createdAt: string
  updatedAt?: string
}

export interface CommunityState {
  categories: CommunityCategory[]
  channels: CommunityChannel[]
  messages: Record<string, CommunityMessage[]>
  members: CommunityMember[]
  lastRead: Record<string, string>
}

// ─── Storage keys ───

const COMMUNITY_KEY = 'x-sutra.community.v1'

// ─── Helpers ───

function nid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ─── Default state ───

function defaultState(): CommunityState {
  return {
    categories: [
      { id: 'cat-general', name: 'GENERAL', collapsed: false, order: 0 },
      { id: 'cat-media', name: 'MEDIA', collapsed: false, order: 1 },
      { id: 'cat-premium', name: 'PREMIUM', collapsed: false, order: 2 },
    ],
    channels: [
      {
        id: 'ch-welcome', categoryId: 'cat-general', name: 'welcome', description: 'Welcome to the community!',
        emoji: '👋', type: 'text', permissions: { view: ['member'], send: ['member'], upload: ['member'] },
        premiumOnly: false, order: 0, createdAt: new Date().toISOString(), unreadCount: 0,
      },
      {
        id: 'ch-general', categoryId: 'cat-general', name: 'general', description: 'General discussion',
        emoji: '💬', type: 'text', permissions: { view: ['member'], send: ['member'], upload: ['member'] },
        premiumOnly: false, order: 1, createdAt: new Date().toISOString(), unreadCount: 0,
      },
      {
        id: 'ch-announcements', categoryId: 'cat-general', name: 'announcements', description: 'Official announcements',
        emoji: '📢', type: 'text', permissions: { view: ['member'], send: ['admin', 'moderator'], upload: ['admin'] },
        premiumOnly: false, order: 2, createdAt: new Date().toISOString(), unreadCount: 0,
      },
      {
        id: 'ch-media', categoryId: 'cat-media', name: 'media-sharing', description: 'Share media with the community',
        emoji: '🖼️', type: 'media', permissions: { view: ['member'], send: ['member'], upload: ['premium', 'admin', 'moderator'] },
        premiumOnly: false, order: 0, createdAt: new Date().toISOString(), unreadCount: 0,
      },
      {
        id: 'ch-gallery', categoryId: 'cat-media', name: 'gallery', description: 'Community gallery',
        emoji: '🎨', type: 'media', permissions: { view: ['member'], send: ['premium', 'admin', 'moderator'], upload: ['premium', 'admin', 'moderator'] },
        premiumOnly: false, order: 1, createdAt: new Date().toISOString(), unreadCount: 0,
      },
      {
        id: 'ch-premium-chat', categoryId: 'cat-premium', name: 'premium-lounge', description: 'Exclusive for premium members',
        emoji: '⭐', type: 'text', permissions: { view: ['premium', 'vip', 'admin'], send: ['premium', 'vip', 'admin'], upload: ['premium', 'vip', 'admin'] },
        premiumOnly: true, order: 0, createdAt: new Date().toISOString(), unreadCount: 0,
      },
      {
        id: 'ch-premium-content', categoryId: 'cat-premium', name: 'premium-content', description: 'Premium exclusive content',
        emoji: '💎', type: 'media', permissions: { view: ['premium', 'vip', 'admin'], send: ['admin'], upload: ['admin'] },
        premiumOnly: true, order: 1, createdAt: new Date().toISOString(), unreadCount: 0,
      },
    ],
    messages: {
      'ch-welcome': [
        {
          id: 'msg-w1', channelId: 'ch-welcome', author: 'admin', authorName: 'Admin', authorRole: 'admin',
          content: 'Welcome to the RedGrab community! 🎉\n\nFeel free to chat, share media, and connect with other members.',
          attachments: [], reactions: [{ emoji: '👋', users: [] }, { emoji: '🎉', users: [] }],
          pinned: true, edited: false, createdAt: new Date(Date.now() - 86400000).toISOString(),
        },
      ],
    },
    members: [],
    lastRead: {},
  }
}

// ─── CRUD ───

export function readCommunity(): CommunityState {
  return readStored<CommunityState>(COMMUNITY_KEY, defaultState())
}

export function writeCommunity(state: CommunityState): CommunityState {
  writeStored(COMMUNITY_KEY, state)
  return state
}

export function ensureCommunity(): CommunityState {
  const raw = readStored<CommunityState | null>(COMMUNITY_KEY, null)
  if (!raw) return writeCommunity(defaultState())
  // Merge with defaults for any missing fields
  const defaults = defaultState()
  const state: CommunityState = {
    categories: raw.categories.length ? raw.categories : defaults.categories,
    channels: raw.channels.length ? raw.channels : defaults.channels,
    messages: raw.messages || defaults.messages,
    members: raw.members || defaults.members,
    lastRead: raw.lastRead || {},
  }
  return state
}

// ─── Categories ───

export function createCategory(name: string): CommunityCategory {
  const state = ensureCommunity()
  const cat: CommunityCategory = {
    id: nid('cat'), name: name.trim().toUpperCase().slice(0, 30),
    collapsed: false, order: state.categories.length,
  }
  state.categories.push(cat)
  writeCommunity(state)
  return cat
}

export function updateCategory(id: string, patch: Partial<Pick<CommunityCategory, 'name' | 'collapsed'>>): void {
  const state = ensureCommunity()
  state.categories = state.categories.map((c) => c.id === id ? { ...c, ...patch } : c)
  writeCommunity(state)
}

export function deleteCategory(id: string): void {
  const state = ensureCommunity()
  const firstCat = state.categories.find((c) => c.id !== id)
  if (firstCat) {
    state.channels = state.channels.map((ch) => ch.categoryId === id ? { ...ch, categoryId: firstCat.id } : ch)
  } else {
    state.channels = state.channels.filter((ch) => ch.categoryId !== id)
  }
  state.categories = state.categories.filter((c) => c.id !== id)
  writeCommunity(state)
}

export function reorderCategories(orderedIds: string[]): void {
  const state = ensureCommunity()
  state.categories = orderedIds.map((id, i) => {
    const cat = state.categories.find((c) => c.id === id)
    return cat ? { ...cat, order: i } : cat!
  }).filter(Boolean)
  writeCommunity(state)
}

// ─── Channels ───

export function createChannel(input: {
  categoryId: string; name: string; description?: string; emoji?: string; type?: 'text' | 'media';
  premiumOnly?: boolean; permissions?: Partial<ChannelPermission>
}): CommunityChannel {
  const state = ensureCommunity()
  const ch: CommunityChannel = {
    id: nid('ch'), categoryId: input.categoryId,
    name: input.name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40),
    description: (input.description || '').trim().slice(0, 200),
    type: input.type || 'text',
    emoji: input.emoji || '#',
    permissions: {
      view: input.permissions?.view || ['member'],
      send: input.permissions?.send || ['member'],
      upload: input.permissions?.upload || ['premium', 'admin', 'moderator'],
    },
    premiumOnly: input.premiumOnly || false,
    order: state.channels.filter((c) => c.categoryId === input.categoryId).length,
    createdAt: new Date().toISOString(),
    unreadCount: 0,
  }
  state.channels.push(ch)
  state.messages[ch.id] = []
  writeCommunity(state)
  return ch
}

export function updateChannel(id: string, patch: Partial<Pick<CommunityChannel, 'name' | 'description' | 'emoji' | 'type' | 'premiumOnly' | 'permissions' | 'categoryId'>>): void {
  const state = ensureCommunity()
  state.channels = state.channels.map((ch) => ch.id === id ? { ...ch, ...patch } : ch)
  writeCommunity(state)
}

export function deleteChannel(id: string): void {
  const state = ensureCommunity()
  state.channels = state.channels.filter((ch) => ch.id !== id)
  delete state.messages[id]
  delete state.lastRead[id]
  writeCommunity(state)
}

export function getChannelsByCategory(categoryId: string): CommunityChannel[] {
  const state = ensureCommunity()
  return state.channels.filter((ch) => ch.categoryId === categoryId).sort((a, b) => a.order - b.order)
}

// ─── Messages ───

export function getMessages(channelId: string, limit = 50, offset = 0): CommunityMessage[] {
  const state = ensureCommunity()
  const msgs = state.messages[channelId] || []
  return msgs.slice().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).slice(offset, offset + limit)
}

export function sendMessage(input: {
  channelId: string; author: string; authorName: string; authorRole: CommunityRole;
  content: string; attachments?: MessageAttachment[]; replyTo?: string;
}): CommunityMessage {
  const state = ensureCommunity()
  const messages = state.messages[input.channelId] || []

  let replyToContent: string | undefined
  let replyToAuthor: string | undefined
  if (input.replyTo) {
    const original = messages.find((m) => m.id === input.replyTo)
    if (original) {
      replyToContent = original.content.slice(0, 150)
      replyToAuthor = original.authorName
    }
  }

  const msg: CommunityMessage = {
    id: nid('msg'), channelId: input.channelId,
    author: input.author, authorName: input.authorName, authorRole: input.authorRole,
    content: input.content.slice(0, 4000),
    attachments: input.attachments || [],
    replyTo: input.replyTo, replyToContent, replyToAuthor,
    reactions: [], pinned: false, edited: false,
    createdAt: new Date().toISOString(),
  }

  messages.push(msg)
  state.messages[input.channelId] = messages

  // Update channel lastMessageAt
  state.channels = state.channels.map((ch) =>
    ch.id === input.channelId ? { ...ch, lastMessageAt: msg.createdAt } : ch
  )

  writeCommunity(state)
  return msg
}

export function editMessage(channelId: string, messageId: string, author: string, newContent: string): boolean {
  const state = ensureCommunity()
  const messages = state.messages[channelId] || []
  const index = messages.findIndex((m) => m.id === messageId && m.author === author)
  if (index < 0) return false
  messages[index] = { ...messages[index], content: newContent.slice(0, 4000), edited: true, updatedAt: new Date().toISOString() }
  state.messages[channelId] = messages
  writeCommunity(state)
  return true
}

export function deleteMessage(channelId: string, messageId: string, requesterRole: CommunityRole): boolean {
  const state = ensureCommunity()
  const messages = state.messages[channelId] || []
  const msg = messages.find((m) => m.id === messageId)
  if (!msg) return false
  // Admin/mod can delete any, others only their own
  if (msg.author !== requesterRole && requesterRole !== 'admin' && requesterRole !== 'moderator') return false
  state.messages[channelId] = messages.filter((m) => m.id !== messageId)
  writeCommunity(state)
  return true
}

export function togglePin(channelId: string, messageId: string, requesterRole: CommunityRole): boolean {
  const state = ensureCommunity()
  if (requesterRole !== 'admin' && requesterRole !== 'moderator') return false
  const messages = state.messages[channelId] || []
  const index = messages.findIndex((m) => m.id === messageId)
  if (index < 0) return false
  messages[index] = { ...messages[index], pinned: !messages[index].pinned }
  state.messages[channelId] = messages
  writeCommunity(state)
  return true
}

export function toggleReaction(channelId: string, messageId: string, emoji: string, username: string): void {
  const state = ensureCommunity()
  const messages = state.messages[channelId] || []
  const index = messages.findIndex((m) => m.id === messageId)
  if (index < 0) return
  const msg = messages[index]
  const reactionIndex = msg.reactions.findIndex((r) => r.emoji === emoji)
  if (reactionIndex >= 0) {
    const reaction = msg.reactions[reactionIndex]
    if (reaction.users.includes(username)) {
      reaction.users = reaction.users.filter((u) => u !== username)
      if (reaction.users.length === 0) msg.reactions.splice(reactionIndex, 1)
    } else {
      reaction.users.push(username)
    }
  } else {
    msg.reactions.push({ emoji, users: [username] })
  }
  state.messages[channelId] = messages
  writeCommunity(state)
}

export function markChannelRead(channelId: string, username: string): void {
  const state = ensureCommunity()
  const messages = state.messages[channelId] || []
  const lastMsg = messages[messages.length - 1]
  if (lastMsg) {
    state.lastRead[channelId] = lastMsg.id
    state.channels = state.channels.map((ch) => ch.id === channelId ? { ...ch, unreadCount: 0 } : ch)
  }
  writeCommunity(state)
}

export function searchMessages(query: string): Array<CommunityMessage & { channelName: string }> {
  const state = ensureCommunity()
  const results: Array<CommunityMessage & { channelName: string }> = []
  const q = query.toLowerCase()
  for (const [channelId, messages] of Object.entries(state.messages)) {
    const channel = state.channels.find((ch) => ch.id === channelId)
    for (const msg of messages) {
      if (msg.content.toLowerCase().includes(q) || msg.authorName.toLowerCase().includes(q)) {
        results.push({ ...msg, channelName: channel?.name || channelId })
      }
    }
  }
  return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 50)
}

// ─── Permissions ───

export function canViewChannel(channel: CommunityChannel, userRole: string): boolean {
  if (channel.premiumOnly && !['premium', 'vip', 'admin'].includes(userRole)) return false
  return channel.permissions.view.some((r) => r === userRole || (userRole === 'admin'))
}

export function canSendToChannel(channel: CommunityChannel, userRole: string): boolean {
  if (userRole === 'admin') return true
  return channel.permissions.send.some((r) => r === userRole)
}

export function canUploadToChannel(channel: CommunityChannel, userRole: string): boolean {
  if (userRole === 'admin') return true
  return channel.permissions.upload.some((r) => r === userRole)
}

export function canEditMessage(msg: CommunityMessage, username: string, role: CommunityRole): boolean {
  return msg.author === username || role === 'admin' || role === 'moderator'
}

export function canDeleteMessage(msg: CommunityMessage, username: string, role: CommunityRole): boolean {
  return msg.author === username || role === 'admin' || role === 'moderator'
}

// ─── Members ───

export function addCommunityMember(username: string, name: string, role: CommunityRole): void {
  const state = ensureCommunity()
  if (!state.members.find((m) => m.username === username)) {
    state.members.push({ username, name, role, joinedAt: new Date().toISOString(), status: 'on' })
    writeCommunity(state)
  }
}

export function updateMemberRole(username: string, role: CommunityRole): void {
  const state = ensureCommunity()
  state.members = state.members.map((m) => m.username === username ? { ...m, role } : m)
  writeCommunity(state)
}

export function getOnlineMembers(): CommunityMember[] {
  const state = ensureCommunity()
  return state.members.filter((m) => m.status === 'on')
}
