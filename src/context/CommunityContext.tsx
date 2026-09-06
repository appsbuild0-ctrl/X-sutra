/**
 * Community context — provides reactive state and actions for the Discord-style community system.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useApp } from './AppContext'
import {
  ensureCommunity, createCategory, updateCategory, deleteCategory,
  createChannel, updateChannel, deleteChannel,
  getMessages, sendMessage, editMessage, deleteMessage as deleteMsg,
  togglePin, toggleReaction, markChannelRead, searchMessages,
  addCommunityMember,
  canViewChannel, canSendToChannel, canUploadToChannel, canEditMessage, canDeleteMessage,
  type CommunityState, type CommunityCategory, type CommunityChannel, type CommunityMessage,
  type CommunityRole, type MessageAttachment, type ChannelPermission,
} from '../lib/community'

interface CommunityContextValue {
  state: CommunityState
  // Categories
  addCategory: (name: string) => CommunityCategory
  renameCategory: (id: string, name: string) => void
  removeCategory: (id: string) => void
  toggleCategoryCollapse: (id: string) => void
  deleteChannel: (id: string) => void
  // Channels
  addChannel: (input: { categoryId: string; name: string; description?: string; emoji?: string; type?: 'text' | 'media'; premiumOnly?: boolean; permissions?: Partial<ChannelPermission> }) => CommunityChannel
  editChannel: (id: string, patch: Partial<Pick<CommunityChannel, 'name' | 'description' | 'emoji' | 'type' | 'premiumOnly' | 'permissions' | 'categoryId'>>) => void
  removeChannel: (id: string) => void
  // Messages
  loadMessages: (channelId: string) => CommunityMessage[]
  postMessage: (channelId: string, content: string, attachments?: MessageAttachment[], replyTo?: string) => CommunityMessage | null
  updateMessage: (channelId: string, messageId: string, content: string) => boolean
  removeMessage: (channelId: string, messageId: string) => boolean
  pinMessage: (channelId: string, messageId: string) => boolean
  reactMessage: (channelId: string, messageId: string, emoji: string) => void
  markRead: (channelId: string) => void
  // Search
  queryMessages: (query: string) => Array<CommunityMessage & { channelName: string }>
  // Permissions
  canView: (channel: CommunityChannel) => boolean
  canSend: (channel: CommunityChannel) => boolean
  canUpload: (channel: CommunityChannel) => boolean
  canEdit: (msg: CommunityMessage) => boolean
  canDelete: (msg: CommunityMessage) => boolean
  isAdmin: boolean
  userRole: CommunityRole
  refresh: () => void
}

const CommunityContext = createContext<CommunityContextValue | null>(null)

function mapUserRole(role?: string): CommunityRole {
  if (role === 'admin') return 'admin'
  if (role === 'vip') return 'admin'
  if (role === 'premium') return 'premium'
  return 'member'
}

export function CommunityProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { account } = useApp()
  const [state, setState] = useState<CommunityState>(ensureCommunity)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => {
    setState(ensureCommunity())
    setTick((t) => t + 1)
  }, [])

  // Register member on login
  useEffect(() => {
    if (account) {
      addCommunityMember(account.username, account.name, mapUserRole(account.role))
      refresh()
    }
  }, [account?.username]) // eslint-disable-line react-hooks/exhaustive-deps

  const userRole = mapUserRole(account?.role)
  const isAdmin = account?.role === 'admin'

  const addCategory = useCallback((name: string) => {
    const cat = createCategory(name)
    refresh()
    return cat
  }, [refresh])

  const renameCategory = useCallback((id: string, name: string) => {
    updateCategory(id, { name })
    refresh()
  }, [refresh])

  const removeCategory = useCallback((id: string) => {
    deleteCategory(id)
    refresh()
  }, [refresh])

  const toggleCategoryCollapse = useCallback((id: string) => {
    const s = ensureCommunity()
    const cat = s.categories.find((c) => c.id === id)
    if (cat) updateCategory(id, { collapsed: !cat.collapsed })
    refresh()
  }, [refresh])

  const addChannel = useCallback((input: Parameters<typeof createChannel>[0]) => {
    const ch = createChannel(input)
    refresh()
    return ch
  }, [refresh])

  const editChannel = useCallback((id: string, patch: Parameters<typeof updateChannel>[1]) => {
    updateChannel(id, patch)
    refresh()
  }, [refresh])

  const deleteChannelFn = useCallback((id: string) => {
    deleteChannel(id)
    refresh()
  }, [refresh]) // eslint-disable-line react-hooks/exhaustive-deps

  const removeChannel = useCallback((id: string) => {
    deleteChannel(id)
    refresh()
  }, [refresh])

  const loadMessages = useCallback((channelId: string) => {
    return getMessages(channelId, 200)
  }, [])

  const postMessage = useCallback((channelId: string, content: string, attachments?: MessageAttachment[], replyTo?: string) => {
    if (!account) return null
    const msg = sendMessage({
      channelId, author: account.username, authorName: account.name,
      authorRole: userRole, content, attachments, replyTo,
    })
    refresh()
    return msg
  }, [account, userRole, refresh])

  const updateMessage = useCallback((channelId: string, messageId: string, content: string) => {
    if (!account) return false
    const ok = editMessage(channelId, messageId, account.username, content)
    if (ok) refresh()
    return ok
  }, [account, refresh])

  const removeMessage = useCallback((channelId: string, messageId: string) => {
    const ok = deleteMsg(channelId, messageId, userRole)
    if (ok) refresh()
    return ok
  }, [userRole, refresh])

  const pinMessage = useCallback((channelId: string, messageId: string) => {
    const ok = togglePin(channelId, messageId, userRole)
    if (ok) refresh()
    return ok
  }, [userRole, refresh])

  const reactMessage = useCallback((channelId: string, messageId: string, emoji: string) => {
    if (!account) return
    toggleReaction(channelId, messageId, emoji, account.username)
    refresh()
  }, [account, refresh])

  const markRead = useCallback((channelId: string) => {
    if (!account) return
    markChannelRead(channelId, account.username)
    refresh()
  }, [account, refresh])

  const queryMessages = useCallback((query: string) => searchMessages(query), [])

  const canView = useCallback((channel: CommunityChannel) => canViewChannel(channel, userRole), [userRole])
  const canSend = useCallback((channel: CommunityChannel) => canSendToChannel(channel, userRole), [userRole])
  const canUpload = useCallback((channel: CommunityChannel) => canUploadToChannel(channel, userRole), [userRole])
  const canEdit = useCallback((msg: CommunityMessage) => account ? canEditMessage(msg, account.username, userRole) : false, [account, userRole])
  const canDelete = useCallback((msg: CommunityMessage) => account ? canDeleteMessage(msg, account.username, userRole) : false, [account, userRole])

  const value = useMemo<CommunityContextValue>(() => ({
    state, addCategory, renameCategory, removeCategory, toggleCategoryCollapse,
    addChannel, editChannel, removeChannel: deleteChannelFn, deleteChannel: deleteChannelFn,
    loadMessages, postMessage, updateMessage, removeMessage, pinMessage, reactMessage, markRead,
    queryMessages, canView, canSend, canUpload, canEdit, canDelete,
    isAdmin, userRole, refresh,
  }), [state, addCategory, renameCategory, removeCategory, toggleCategoryCollapse, addChannel, editChannel, removeChannel, loadMessages, postMessage, updateMessage, removeMessage, pinMessage, reactMessage, markRead, queryMessages, canView, canSend, canUpload, canEdit, canDelete, isAdmin, userRole, refresh, tick])

  return <CommunityContext.Provider value={value}>{children}</CommunityContext.Provider>
}

export function useCommunity(): CommunityContextValue {
  const ctx = useContext(CommunityContext)
  if (!ctx) throw new Error('useCommunity must be used inside CommunityProvider')
  return ctx
}
