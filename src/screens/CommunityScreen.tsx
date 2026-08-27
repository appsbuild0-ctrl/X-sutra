/**
 * CommunityScreen — Stack-based navigation: channel list → chat view.
 * Mobile-first, no sidebar. Back button returns to channel list.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useCommunity } from '../context/CommunityContext'
import { useApp } from '../context/AppContext'
import type { CommunityChannel, CommunityCategory, CommunityMessage, MessageAttachment } from '../lib/community'
import { HashIcon, ChevronRightIcon, SearchIcon, PlusIcon, SendIcon, PinIcon, TrashIcon, EditIcon, SmileIcon, ReplyIcon, XIcon } from '../components/icons'

const CHANNEL_EMOJIS = ['#', '💬', '📢', '🖼️', '🎨', '⭐', '💎', '🔥', '🎮', '🎵', '🎬', '📸', '🤖', '🔒', '🏠', '🎉', '❤️', '💀', '📰', '🛒', '⚽', '🌍', '🧪', '🎯', '📁', '🎶']
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '🎉', '👀', '💯', '😮', '😢', '🤔', '👏', '🙌', '💀', '✅', '❌', '⭐']

// ─── Small helpers ───
function EmojiPicker({ emojis, onSelect, onClose }: { emojis: string[]; onSelect: (e: string) => void; onClose: () => void }): React.JSX.Element {
  return (
    <div className="emoji-picker" onClick={(e) => e.stopPropagation()}>
      <div className="emoji-picker__grid">
        {emojis.map((emoji) => (
          <button key={emoji} type="button" className="emoji-btn" onClick={() => { onSelect(emoji); onClose() }}>{emoji}</button>
        ))}
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000 && d.getDate() === now.getDate()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff < 604800000) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

// ─── Image grid ───
function ImageGrid({ attachments }: { attachments: MessageAttachment[] }): React.JSX.Element {
  const images = attachments.filter((a) => a.type === 'image')
  const videos = attachments.filter((a) => a.type === 'video')
  const files = attachments.filter((a) => a.type === 'file')
  const [lbIdx, setLbIdx] = useState<number | null>(null)

  return (
    <div className="msg-attachments">
      {images.length > 0 && (
        <div className={`msg-image-grid msg-image-grid--${Math.min(images.length, 4)}`}>
          {images.slice(0, 4).map((img, i) => (
            <button key={img.id} type="button" className="msg-image-btn" onClick={() => setLbIdx(i)}>
              <img src={img.url} alt={img.name} loading="lazy" />
              {i === 3 && images.length > 4 && <span className="msg-image-overflow">+{images.length - 4}</span>}
            </button>
          ))}
        </div>
      )}
      {videos.map((v) => (
        <div key={v.id} className="msg-video-card">
          <video src={v.url} controls preload="metadata" className="msg-video" />
          <div className="msg-video-info"><span>{v.name}</span><span>{formatSize(v.size)}</span></div>
        </div>
      ))}
      {files.map((f) => (
        <div key={f.id} className="msg-file-card">
          <div className="msg-file-icon">📄</div>
          <div className="msg-file-info"><span className="msg-file-name">{f.name}</span><span className="msg-file-size">{formatSize(f.size)}</span></div>
          <a href={f.url} download={f.name} className="msg-file-dl">⬇</a>
        </div>
      ))}
      {lbIdx !== null && (
        <div className="lightbox" onClick={() => setLbIdx(null)}>
          <div className="lightbox__inner" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="lightbox__close" onClick={() => setLbIdx(null)}><XIcon size={24} /></button>
            <button type="button" className="lightbox__prev" disabled={lbIdx === 0} onClick={() => setLbIdx((i) => i! - 1)}>‹</button>
            <img src={images[lbIdx].url} alt="" className="lightbox__img" />
            <button type="button" className="lightbox__next" disabled={lbIdx >= images.length - 1} onClick={() => setLbIdx((i) => i! + 1)}>›</button>
            <div className="lightbox__counter">{lbIdx + 1} / {images.length}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Message Bubble ───
function MessageBubble({ msg, onReply, onEdit, onDelete, onPin, onReact, me }: {
  msg: CommunityMessage; onReply: () => void; onEdit: () => void; onDelete: () => void; onPin: () => void; onReact: (emoji: string) => void; me?: string
}): React.JSX.Element {
  const [showBar, setShowBar] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const own = msg.author === me
  const rc = msg.authorRole === 'admin' ? 'var(--ember-strong)' : msg.authorRole === 'premium' ? 'var(--gold)' : 'var(--text)'
  const badge = msg.authorRole === 'admin' ? '👑' : msg.authorRole === 'premium' ? '⭐' : ''

  return (
    <div className={`msg-bubble ${msg.pinned ? 'msg-bubble--pinned' : ''}`}
      onPointerEnter={() => setShowBar(true)} onPointerLeave={() => { setShowBar(false); setShowEmoji(false) }}>
      {msg.pinned && <div className="msg-pin-badge"><PinIcon size={12} /> Pinned</div>}
      {msg.replyTo && msg.replyToContent && (
        <div className="msg-reply-indicator"><ReplyIcon size={14} /><span className="msg-reply-author">{msg.replyToAuthor}</span><span className="msg-reply-content">{msg.replyToContent}</span></div>
      )}
      <div className="msg-bubble__row">
        <div className="msg-avatar" style={{ background: `hsl(${msg.author.charCodeAt(0) * 7 % 360} 40% 30%)` }}>{msg.authorName.charAt(0).toUpperCase()}</div>
        <div className="msg-body">
          <div className="msg-meta">
            <span className="msg-author" style={{ color: rc }}>{msg.authorName}</span>
            {badge && <span className="msg-badge">{badge}</span>}
            <span className="msg-time">{formatTime(msg.createdAt)}</span>
            {msg.edited && <span className="msg-edited">(edited)</span>}
          </div>
          <div className="msg-content">{msg.content}</div>
          {msg.attachments.length > 0 && <ImageGrid attachments={msg.attachments} />}
          {msg.reactions.length > 0 && (
            <div className="msg-reactions">
              {msg.reactions.map((r) => (
                <button key={r.emoji} type="button" className={`msg-reaction ${r.users.includes(me || '') ? 'msg-reaction--active' : ''}`} onClick={() => onReact(r.emoji)}>{r.emoji} {r.users.length}</button>
              ))}
              <button type="button" className="msg-reaction msg-reaction--add" onClick={() => setShowEmoji(true)}>+</button>
            </div>
          )}
        </div>
        {showBar && (
          <div className="msg-actions">
            <button type="button" onClick={() => setShowEmoji(!showEmoji)} title="React"><SmileIcon size={16} /></button>
            <button type="button" onClick={onReply} title="Reply"><ReplyIcon size={16} /></button>
            {own && <button type="button" onClick={onEdit} title="Edit"><EditIcon size={16} /></button>}
            <button type="button" onClick={onDelete} title="Delete"><TrashIcon size={16} /></button>
            <button type="button" onClick={onPin} title={msg.pinned ? 'Unpin' : 'Pin'}><PinIcon size={16} /></button>
          </div>
        )}
        {showEmoji && <EmojiPicker emojis={REACTION_EMOJIS} onSelect={onReact} onClose={() => setShowEmoji(false)} />}
      </div>
    </div>
  )
}

// ─── Context Menu ───
function CtxMenu({ x, y, items, onClose }: { x: number; y: number; items: Array<{ label: string; onClick: () => void; danger?: boolean }>; onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const h = () => onClose()
    window.addEventListener('click', h)
    window.addEventListener('contextmenu', h)
    return () => { window.removeEventListener('click', h); window.removeEventListener('contextmenu', h) }
  }, [onClose])
  return (
    <div className="ctx-menu" style={{ top: y, left: x }} onClick={(e) => e.stopPropagation()}>
      {items.map((it) => (
        <button key={it.label} type="button" className={`ctx-menu__item ${it.danger ? 'ctx-menu__item--danger' : ''}`}
          onClick={() => { it.onClick(); onClose() }}><span>{it.label}</span></button>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════
//  VIEW 1: Channel List
// ═══════════════════════════════════════════════════════
function ChannelListView({ onOpen }: { onOpen: (ch: CommunityChannel) => void }): React.JSX.Element {
  const { state, isAdmin, toggleCategoryCollapse, addChannel, removeCategory, deleteChannel, canView, refresh } = useCommunity()
  const { notify } = useApp()
  const [creating, setCreating] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [ctx, setCtx] = useState<{ x: number; y: number; type: 'channel' | 'category'; target: CommunityChannel | CommunityCategory } | null>(null)
  const [editCh, setEditCh] = useState<CommunityChannel | null>(null)
  const [editEmoji, setEditEmoji] = useState('#')
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editCatId, setEditCatId] = useState('')
  const [editPremium, setEditPremium] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [renameCat, setRenameCat] = useState<CommunityCategory | null>(null)
  const [renameCatVal, setRenameCatVal] = useState('')

  const cats = state.categories.slice().sort((a, b) => a.order - b.order)

  const doCreate = (catId: string) => {
    if (!newName.trim()) return
    addChannel({ categoryId: catId, name: newName })
    setNewName(''); setCreating(null); notify('Channel created', 'success')
  }

  const onCtx = (e: React.MouseEvent | React.TouchEvent, type: 'channel' | 'category', target: CommunityChannel | CommunityCategory) => {
    if (!isAdmin) return
    e.preventDefault(); e.stopPropagation()
    let cx = 0, cy = 0
    if ('touches' in e) { cx = e.touches[0].clientX; cy = e.touches[0].clientY }
    else { cx = (e as React.MouseEvent).clientX; cy = (e as React.MouseEvent).clientY }
    setCtx({ x: Math.min(cx, window.innerWidth - 200), y: Math.min(cy, window.innerHeight - 150), type, target })
  }

  const openEdit = (ch: CommunityChannel) => {
    setEditCh(ch); setEditEmoji(ch.emoji || '#'); setEditName(ch.name); setEditDesc(ch.description); setEditCatId(ch.categoryId); setEditPremium(ch.premiumOnly)
  }

  const saveEdit = () => {
    if (!editCh) return
    const { editChannel } = useCommunity()
    editChannel(editCh.id, { name: editName.trim(), emoji: editEmoji, description: editDesc, categoryId: editCatId, premiumOnly: editPremium })
    refresh(); notify('Channel updated', 'success'); setEditCh(null)
  }

  return (
    <div className="comm-view comm-list">
      <div className="comm-list__header">
        <div><h2>Community</h2><span className="comm-list__sub">RedGrab Server</span></div>
        <SearchIcon size={20} />
      </div>

      <div className="comm-list__body">
        {cats.map((cat) => {
          const chs = state.channels.filter((c) => c.categoryId === cat.id).sort((a, b) => a.order - b.order).filter((c) => canView(c))
          return (
            <div key={cat.id} className="cat-section">
              <button type="button" className="cat-header" onClick={() => toggleCategoryCollapse(cat.id)}
                onContextMenu={(e) => onCtx(e, 'category', cat)}
                onPointerDown={(e) => { if (isAdmin && e.pointerType === 'touch') { let t: ReturnType<typeof setTimeout>; const cl = () => { clearTimeout(t); window.removeEventListener('pointerup', cl) }; t = setTimeout(() => { onCtx(e, 'category', cat); cl() }, 500); window.addEventListener('pointerup', cl, { once: true }) } }}>
                <ChevronRightIcon size={12} className={`cat-chevron ${cat.collapsed ? '' : 'cat-chevron--open'}`} />
                <span className="cat-name">{cat.name}</span>
                {isAdmin && <button type="button" className="cat-add" onClick={(ev) => { ev.stopPropagation(); setCreating(cat.id) }}><PlusIcon size={14} /></button>}
              </button>
              {!cat.collapsed && chs.map((ch) => (
                <button key={ch.id} type="button" className={`ch-item ${ch.premiumOnly ? 'ch-item--premium' : ''}`}
                  onClick={() => onOpen(ch)}
                  onContextMenu={(e) => onCtx(e, 'channel', ch)}
                  onPointerDown={(e) => { if (isAdmin && e.pointerType === 'touch') { let t: ReturnType<typeof setTimeout>; const cl = () => { clearTimeout(t); window.removeEventListener('pointerup', cl) }; t = setTimeout(() => { onCtx(e, 'channel', ch); cl() }, 500); window.addEventListener('pointerup', cl, { once: true }) } }}>
                  <span className="ch-emoji">{ch.emoji || '#'}</span>
                  <div className="ch-info">
                    <span className="ch-name">{ch.name}</span>
                    {ch.description && <span className="ch-desc">{ch.description}</span>}
                  </div>
                  {ch.premiumOnly && <span className="ch-badge">⭐</span>}
                  {ch.unreadCount > 0 && <span className="ch-unread">{ch.unreadCount}</span>}
                </button>
              ))}
            </div>
          )
        })}
      </div>

      {creating && (
        <div className="comm-create-bar">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="new-channel" autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') doCreate(creating); if (e.key === 'Escape') setCreating(null) }} />
          <button type="button" className="primary-button" onClick={() => doCreate(creating)}>Create</button>
        </div>
      )}

      {ctx && <CtxMenu x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} items={
        ctx.type === 'channel' ? [
          { label: '✏️ Edit', onClick: () => openEdit(ctx.target as CommunityChannel) },
          { label: '🗑️ Delete', onClick: () => { if (window.confirm('Delete channel?')) { deleteChannel(ctx.target.id); notify('Channel deleted') } }, danger: true },
        ] : [
          { label: '✏️ Rename', onClick: () => { setRenameCat(ctx.target as CommunityCategory); setRenameCatVal(ctx.target.name) } },
          { label: '🗑️ Delete', onClick: () => { if (window.confirm('Delete category?')) { removeCategory(ctx.target.id); notify('Category deleted') } }, danger: true },
        ]
      } />}

      {editCh && (
        <div className="comm-modal" onClick={() => setEditCh(null)}>
          <div className="comm-modal__box" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Channel</h3>
            <label className="comm-field"><span>Emoji</span>
              <div className="emoji-row">
                <button type="button" className="emoji-row__cur" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>{editEmoji}</button>
                {showEmojiPicker && <div className="emoji-row__grid">{CHANNEL_EMOJIS.map((e) => <button key={e} type="button" className="emoji-btn" onClick={() => { setEditEmoji(e); setShowEmojiPicker(false) }}>{e}</button>)}</div>}
              </div>
            </label>
            <label className="comm-field"><span>Name</span><input value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
            <label className="comm-field"><span>Description</span><input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} /></label>
            <label className="comm-field"><span>Category</span>
              <select value={editCatId} onChange={(e) => setEditCatId(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
            <label className="comm-toggle"><span>Premium Only</span><input className="switch" type="checkbox" checked={editPremium} onChange={(e) => setEditPremium(e.target.checked)} /></label>
            <div className="comm-modal__actions">
              <button type="button" className="primary-button" onClick={saveEdit}>Save</button>
              <button type="button" className="secondary-button" onClick={() => setEditCh(null)}>Cancel</button>
              <button type="button" className="text-button" style={{ color: 'var(--danger)' }} onClick={() => { if (window.confirm('Delete?')) { deleteChannel(editCh.id); setEditCh(null); notify('Deleted') } }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {renameCat && (
        <div className="comm-modal" onClick={() => setRenameCat(null)}>
          <div className="comm-modal__box" onClick={(e) => e.stopPropagation()}>
            <h3>Rename Category</h3>
            <label className="comm-field"><span>Name</span><input value={renameCatVal} onChange={(e) => setRenameCatVal(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { const { renameCategory } = useCommunity(); renameCategory(renameCat.id, renameCatVal.trim()); refresh(); notify('Renamed'); setRenameCat(null) } }} /></label>
            <div className="comm-modal__actions">
              <button type="button" className="primary-button" onClick={() => { const { renameCategory } = useCommunity(); renameCategory(renameCat.id, renameCatVal.trim()); refresh(); notify('Renamed'); setRenameCat(null) }}>Save</button>
              <button type="button" className="secondary-button" onClick={() => setRenameCat(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════
//  VIEW 2: Chat
// ═══════════════════════════════════════════════════════
function ChatView({ channel, onBack }: { channel: CommunityChannel; onBack: () => void }): React.JSX.Element {
  const { postMessage, updateMessage, removeMessage, pinMessage, reactMessage, markRead, loadMessages, canSend, canUpload } = useCommunity()
  const { account, notify } = useApp()
  const [msgs, setMsgs] = useState<CommunityMessage[]>([])
  const [input, setInput] = useState('')
  const [replyTo, setReplyTo] = useState<CommunityMessage | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editTxt, setEditTxt] = useState('')
  const [uploading, setUploading] = useState(false)
  const [upProg, setUpProg] = useState('')
  const [showUploadMenu, setShowUploadMenu] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLInputElement>(null)
  const vidRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(() => setMsgs(loadMessages(channel.id)), [channel.id, loadMessages])

  useEffect(() => { reload(); markRead(channel.id); setReplyTo(null); setEditId(null) }, [channel.id]) // eslint-disable-line
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs.length])

  const send = useCallback(() => {
    const t = input.trim()
    if (!t || !account) return
    postMessage(channel.id, t, undefined, replyTo?.id)
    reload(); setInput(''); setReplyTo(null)
  }, [input, account, channel.id, postMessage, reload, replyTo])

  const doUpload = async (files: FileList | null) => {
    if (!files || !account) return
    setUploading(true); setUpProg('Uploading...')
    const atts: MessageAttachment[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; setUpProg(`${i + 1}/${files.length}...`)
      try {
        const url = URL.createObjectURL(f)
        const type: MessageAttachment['type'] = f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : 'file'
        atts.push({ id: `att-${Date.now()}-${i}`, type, url, name: f.name, size: f.size, mimeType: f.type })
      } catch { notify(`Failed: ${f.name}`, 'error') }
    }
    if (atts.length) { postMessage(channel.id, input.trim() || '', atts, replyTo?.id); reload(); setInput(''); setReplyTo(null) }
    setUploading(false); setUpProg(''); setShowUploadMenu(false)
  }

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editId ? doEdit(editId) : send() }
    if (e.key === 'Escape') { setReplyTo(null); setEditId(null) }
  }

  const doEdit = (id: string) => { if (!editTxt.trim()) return; updateMessage(channel.id, id, editTxt); reload(); setEditId(null); setEditTxt('') }
  const doDelete = (id: string) => { if (!window.confirm('Delete?')) return; removeMessage(channel.id, id); reload() }

  return (
    <div className="comm-view comm-chat">
      <div className="chat-header">
        <button type="button" className="chat-back" onClick={onBack}>←</button>
        <div className="chat-header__info">
          <span className="chat-header__emoji">{channel.emoji || '#'}</span>
          <div>
            <span className="chat-header__name">{channel.name}</span>
            {channel.description && <span className="chat-header__desc">{channel.description}</span>}
          </div>
        </div>
        {channel.premiumOnly && <span className="chat-header__premium">⭐</span>}
      </div>

      <div className="chat-messages">
        {msgs.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty__icon"><span style={{ fontSize: 32 }}>{channel.emoji || '#'}</span></div>
            <strong>Welcome to #{channel.name}</strong>
            <span>This is the start of #{channel.name}</span>
          </div>
        )}
        {msgs.map((m) => (
          <MessageBubble key={m.id} msg={m} me={account?.username}
            onReply={() => setReplyTo(m)}
            onEdit={() => { setEditId(m.id); setEditTxt(m.content) }}
            onDelete={() => doDelete(m.id)}
            onPin={() => { pinMessage(channel.id, m.id); reload() }}
            onReact={(e) => { reactMessage(channel.id, m.id, e); reload() }} />
        ))}
        <div ref={bottomRef} />
      </div>

      {(replyTo || editId) && (
        <div className="chat-reply-bar">
          {replyTo && <><ReplyIcon size={16} /><span>Reply to <strong>{replyTo.authorName}</strong></span></>}
          {editId && <><EditIcon size={16} /><span>Editing</span></>}
          <button type="button" onClick={() => { setReplyTo(null); setEditId(null) }}><XIcon size={16} /></button>
        </div>
      )}

      {canSend(channel) ? (
        <div className="chat-input-area">
          {canUpload(channel) && (
            <div className="chat-plus-wrap">
              <button type="button" className="chat-plus" onClick={() => setShowUploadMenu(!showUploadMenu)}>+</button>
              {showUploadMenu && (
                <div className="upload-menu">
                  <button type="button" onClick={() => { imgRef.current?.click() }}>📷 Image</button>
                  <button type="button" onClick={() => { vidRef.current?.click() }}>🎥 Video</button>
                  <button type="button" onClick={() => { fileRef.current?.click() }}>📁 File</button>
                </div>
              )}
            </div>
          )}
          <input ref={imgRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void doUpload(e.target.files); e.target.value = '' }} />
          <input ref={vidRef} type="file" accept="video/*" multiple className="sr-only" onChange={(e) => { void doUpload(e.target.files); e.target.value = '' }} />
          <input ref={fileRef} type="file" multiple className="sr-only" onChange={(e) => { void doUpload(e.target.files); e.target.value = '' }} />
          <textarea className="chat-input" value={editId ? editTxt : input}
            onChange={(e) => editId ? setEditTxt(e.target.value) : setInput(e.target.value)}
            onKeyDown={handleKey} placeholder={`Message #${channel.name}...`} rows={1} />
          <button type="button" className="chat-send" onClick={editId ? () => doEdit(editId) : send}
            disabled={editId ? !editTxt.trim() : !input.trim()}><SendIcon size={18} /></button>
        </div>
      ) : (
        <div className="chat-locked">No permission to send messages here.</div>
      )}

      {uploading && <div className="chat-upload-status">{upProg}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════
//  MAIN: Stack navigator
// ═══════════════════════════════════════════════════════
export function CommunityScreen(): React.JSX.Element {
  const [active, setActive] = useState<CommunityChannel | null>(null)

  if (active) return <ChatView channel={active} onBack={() => setActive(null)} />
  return <ChannelListView onOpen={setActive} />
}
