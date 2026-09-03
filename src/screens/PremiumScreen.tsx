/**
 * PremiumScreen — community channel system.
 * Stack-based: channel list → chat view. Accessible via /premium with a
 * local premium/vip role assigned by the admin.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { CrownMark } from '../components/CrownMark'
import { PayQrModal, PlanCards, type PlanId } from '../components/PlanPay'
import { useApp } from '../context/AppContext'
import { useCommunity } from '../context/CommunityContext'
import { uploadToCloudinary, isCloudinaryConfigured } from '../lib/cloudinary'
import { UNCROPPED_IMAGE_STYLE } from '../lib/imageFit'
import { hasPremiumAccess, roleLabel } from '../lib/roles'
import type { CommunityChannel, CommunityCategory, CommunityMessage, MessageAttachment } from '../lib/community'
import { ChevronRightIcon, PlusIcon, SendIcon, PinIcon, TrashIcon, EditIcon, SmileIcon, ReplyIcon, XIcon } from '../components/icons'

const CHANNEL_EMOJIS = ['#', '💬', '📢', '🖼️', '🎨', '⭐', '💎', '🔥', '🎮', '🎵', '🎬', '📸', '🤖', '🔒', '🏠', '🎉', '❤️', '💀', '📰', '🛒', '⚽', '🌍', '🧪', '🎯', '📁', '🎶']
let _longPressFired = false
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '🎉', '👀', '💯', '😮', '😢', '🤔', '👏', '🙌', '💀', '✅', '❌', '⭐']

// ─── Helpers ───
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
  const d = new Date(iso); const now = new Date(); const diff = now.getTime() - d.getTime()
  if (diff < 86400000 && d.getDate() === now.getDate()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff < 604800000) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

// ─── Image grid (Telegram-style) ───
function ImageGrid({ attachments, authorName }: { attachments: MessageAttachment[]; authorName?: string }): React.JSX.Element {
  const images = attachments.filter((a) => a.type === 'image')
  const videos = attachments.filter((a) => a.type === 'video')
  const files = attachments.filter((a) => a.type === 'file')
  const [lbIdx, setLbIdx] = useState<number | null>(null)
  const [swipeX, setSwipeX] = useState(0)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const [zoomScale, setZoomScale] = useState(1)
  const lastTap = useRef<number>(0)

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    setSwipeX(0)
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return
    const dx = e.touches[0].clientX - touchStart.current.x
    setSwipeX(dx)
  }
  const handleTouchEnd = () => {
    if (swipeX > 80) {
      setLbIdx(null)
    } else if (swipeX < -80 && lbIdx !== null && lbIdx < images.length - 1) {
      setLbIdx((i) => i! + 1)
    } else if (swipeX < -80 && lbIdx !== null && lbIdx >= images.length - 1) {
      setLbIdx(null)
    }
    setSwipeX(0); touchStart.current = null
  }
  const handleDoubleTap = () => {
    const now = Date.now()
    if (now - lastTap.current < 300) { setZoomScale((z) => z > 1 ? 1 : 2.5) }
    lastTap.current = now
  }

  const gridCols = Math.min(images.length, 4)
  const gridClass = `tg-image-grid tg-image-grid--${gridCols}`

  return (
    <div className="msg-attachments">
      {images.length > 0 && (
        <div className={gridClass} style={{ display: 'grid', gap: 3, borderRadius: 12, overflow: 'hidden', maxWidth: 420, alignItems: 'start', gridTemplateColumns: gridCols === 1 ? '1fr' : '1fr 1fr' }}>
          {images.slice(0, 4).map((img, i) => (
            <button key={img.id} type="button" className="tg-image-btn" onClick={() => { setLbIdx(i); setZoomScale(1) }} style={{ position: 'relative', display: 'block', overflow: 'hidden', borderRadius: 12, background: '#1a1415', border: 'none', padding: 0, cursor: 'pointer' }}>
              {/* original aspect ratio + resolution: fitted, never cropped */}
              <img src={img.url} alt={img.name} loading="lazy" draggable={false} style={{ ...UNCROPPED_IMAGE_STYLE, maxHeight: 340 }} />
              {i === 3 && images.length > 4 && <span className="tg-image-overflow">+{images.length - 4}</span>}
            </button>
          ))}
        </div>
      )}
      {videos.map((v) => (
        <div key={v.id} className="tg-video-card" onClick={(e) => e.stopPropagation()}>
          <video src={v.url} controls preload="metadata" playsInline className="tg-video" />
          <div className="tg-video-meta"><span className="tg-video-name">{v.name}</span><span className="tg-video-size">{formatSize(v.size)}</span></div>
        </div>
      ))}
      {files.map((f) => (
        <div key={f.id} className="tg-file-card">
          <div className="tg-file-icon">📄</div>
          <div className="tg-file-info"><span className="tg-file-name">{f.name}</span><span className="tg-file-size">{formatSize(f.size)}</span></div>
          <a href={f.url} download={f.name} className="tg-file-dl" onClick={(e) => e.stopPropagation()}>⬇</a>
        </div>
      ))}
      {lbIdx !== null && (
        <div className="tg-lightbox" onClick={() => setLbIdx(null)}>
          <div className="tg-lightbox__header">
            <button type="button" className="tg-lightbox__back" onClick={() => setLbIdx(null)}>←</button>
            <span className="tg-lightbox__title">{authorName || 'Photo'}</span>
            <span className="tg-lightbox__counter">{lbIdx + 1} / {images.length}</span>
          </div>
          <div className="tg-lightbox__stage"
            onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
            onClick={(e) => e.stopPropagation()}>
            <img src={images[lbIdx].url} alt=""
              className="tg-lightbox__img"
              style={{ transform: `translateX(${swipeX * 0.4}px) scale(${zoomScale})`, transition: swipeX ? 'none' : 'transform .2s', opacity: Math.max(0.3, 1 - Math.abs(swipeX) / 300) }}
              onDoubleClick={handleDoubleTap} draggable={false} />
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
          {msg.attachments.length > 0 && <ImageGrid attachments={msg.attachments} authorName={msg.authorName} />}
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
    const h = () => onClose(); window.addEventListener('click', h); window.addEventListener('contextmenu', h)
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
function PremiumChannelList({ onOpen }: { onOpen: (ch: CommunityChannel) => void }): React.JSX.Element {
  const navigate = useNavigate()
  const { account } = useApp()
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
    addChannel({ categoryId: catId, name: newName }); setNewName(''); setCreating(null); notify('Channel created', 'success')
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
    <section className="screen comm-view comm-list">
      <header className="comm-list__header">
        <div style={{ flex: 1 }}>
          <button type="button" className="comm-back-btn" onClick={() => navigate('/')}>← </button>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 22 }}>💎</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 20 }}>Premium</h2>
              <small style={{ color: 'var(--muted)', fontSize: 10 }}>{roleLabel(account?.role)} · {state.channels.filter((c) => canView(c)).length} channels</small>
            </div>
          </span>
        </div>
      </header>

      <div className="comm-list__body">
        {cats.map((cat) => {
          const chs = state.channels.filter((c) => c.categoryId === cat.id).sort((a, b) => a.order - b.order).filter((c) => canView(c))
          if (chs.length === 0 && cat.collapsed) return null
          return (
            <div key={cat.id} className="cat-section">
              <div className="cat-header" style={{ display: 'flex', alignItems: 'center' }}>
                <button type="button" className="cat-header__main" onClick={() => toggleCategoryCollapse(cat.id)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left' }}>
                  <ChevronRightIcon size={12} className={`cat-chevron ${cat.collapsed ? '' : 'cat-chevron--open'}`} />
                  <span className="cat-name">{cat.name}</span>
                </button>
                {isAdmin && <button type="button" className="cat-add" onClick={() => setCreating(cat.id)} style={{ background: 'none', border: 'none', color: 'var(--muted)', padding: '2px 4px', cursor: 'pointer' }}><PlusIcon size={14} /></button>}
                {isAdmin && <button type="button" className="ch-dots" onClick={(ev) => { ev.stopPropagation(); onCtx(ev, 'category', cat) }} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, padding: '4px 6px', cursor: 'pointer', lineHeight: 1 }}>⋮</button>}
              </div>
              {!cat.collapsed && chs.map((ch) => (
                <div key={ch.id} className={`ch-item ${ch.premiumOnly ? 'ch-item--premium' : ''}`} style={{ display: 'flex', alignItems: 'center' }}>
                  <button type="button" className="ch-item__main" onClick={() => onOpen(ch)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left', minWidth: 0 }}>
                    <span className="ch-emoji">{ch.emoji || '#'}</span>
                    <div className="ch-info">
                      <span className="ch-name">{ch.name}</span>
                      {ch.description && <span className="ch-desc">{ch.description}</span>}
                    </div>
                    {ch.premiumOnly && <span className="ch-badge">⭐</span>}
                    {ch.unreadCount > 0 && <span className="ch-unread">{ch.unreadCount}</span>}
                  </button>
                  {isAdmin && <button type="button" className="ch-dots" onClick={(ev) => { ev.stopPropagation(); onCtx(ev, 'channel', ch) }} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, padding: '4px 8px', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>⋮</button>}
                </div>
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
            <label className="comm-field"><span>Emoji (type any emoji from keyboard)</span>
              <div className="emoji-row">
                <input type="text" className="emoji-row__input" value={editEmoji} onChange={(ev) => setEditEmoji(ev.target.value)} placeholder="💬" maxLength={4} inputMode="text" style={{ fontSize: 22, width: 60, textAlign: 'center', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 4px', color: 'var(--text)' }} />
                <span style={{ fontSize: 24, marginLeft: 8 }}>{editEmoji || '💬'}</span>
              </div>
              <div className="emoji-row" style={{ marginTop: 4 }}>
                {CHANNEL_EMOJIS.slice(0, 12).map((e) => <button key={e} type="button" className="emoji-btn" onClick={() => setEditEmoji(e)} style={{ fontSize: 18 }}>{e}</button>)}
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
    </section>
  )
}

// ═══════════════════════════════════════════════════════
//  VIEW 2: Chat
// ═══════════════════════════════════════════════════════
function PremiumChatView({ channel, onBack }: { channel: CommunityChannel; onBack: () => void }): React.JSX.Element {
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
    const t = input.trim(); if (!t || !account) return
    postMessage(channel.id, t, undefined, replyTo?.id); reload(); setInput(''); setReplyTo(null)
  }, [input, account, channel.id, postMessage, reload, replyTo])

  const doUpload = async (files: FileList | null) => {
    if (!files || !account) return
    setUploading(true); setUpProg('Uploading...'); const atts: MessageAttachment[] = []
    const useCloudinary = isCloudinaryConfigured()
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      try {
        if (useCloudinary) {
          setUpProg(`Uploading ${i + 1}/${files.length}...`)
          const res = await uploadToCloudinary(f, 'redgrab', (pct) => setUpProg(`${f.name} ${pct}%`))
          const type: MessageAttachment['type'] = f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : 'file'
          atts.push({ id: `att-${Date.now()}-${i}-${Math.random().toString(36).slice(2,6)}`, type, url: res.secure_url, name: f.name, size: f.size, mimeType: f.type, width: res.width, height: res.height })
        } else {
          setUpProg(`Compressing ${i + 1}/${files.length}...`)
          const { compressToFile } = await import('../lib/compressMedia')
          const url = await compressToFile(f)
          const type: MessageAttachment['type'] = f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : 'file'
          atts.push({ id: `att-${Date.now()}-${i}-${Math.random().toString(36).slice(2,6)}`, type, url, name: f.name, size: f.size, mimeType: f.type })
        }
      } catch (err) { notify(`Upload failed: ${f.name} — ${err instanceof Error ? err.message : 'Unknown error'}`, 'error') }
    }
    if (atts.length) {
      postMessage(channel.id, input.trim() || '', atts, replyTo?.id); reload(); setInput(''); setReplyTo(null)
      // Verify storage succeeded
      try {
        const testKey = '__storage_test__'
        localStorage.setItem(testKey, '1'); localStorage.removeItem(testKey)
      } catch {
        notify('Storage full — images may not persist after refresh. Set up Cloudinary for permanent storage.', 'error')
      }
    }
    setUploading(false); setUpProg(''); setShowUploadMenu(false)
  }

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editId ? doEdit(editId) : send() }
    if (e.key === 'Escape') { setReplyTo(null); setEditId(null) }
  }
  const doEdit = (id: string) => { if (!editTxt.trim()) return; updateMessage(channel.id, id, editTxt); reload(); setEditId(null); setEditTxt('') }
  const doDelete = (id: string) => { if (!window.confirm('Delete?')) return; removeMessage(channel.id, id); reload() }

  return (
    <section className="screen comm-view comm-chat">
      <div className="chat-header">
        <button type="button" className="chat-back" onClick={onBack}>←</button>
        <div className="chat-header__info">
          <span className="chat-header__emoji">{channel.emoji || '#'}</span>
          <div><span className="chat-header__name">{channel.name}</span>{channel.description && <span className="chat-header__desc">{channel.description}</span>}</div>
        </div>
        {channel.premiumOnly && <span className="chat-header__premium">⭐</span>}
      </div>
      <div className="chat-messages">
        {msgs.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty__icon"><span style={{ fontSize: 32 }}>{channel.emoji || '#'}</span></div>
            <strong>Welcome to #{channel.name}</strong><span>This is the start of #{channel.name}</span>
          </div>
        )}
        {msgs.map((m) => (
          <MessageBubble key={m.id} msg={m} me={account?.username}
            onReply={() => setReplyTo(m)} onEdit={() => { setEditId(m.id); setEditTxt(m.content) }}
            onDelete={() => doDelete(m.id)} onPin={() => { pinMessage(channel.id, m.id); reload() }}
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
      ) : <div className="chat-locked">No permission to send messages here.</div>}
      {uploading && <div className="chat-upload-status">{upProg}</div>}
    </section>
  )
}

// ═══════════════════════════════════════════════════════
//  GATE: local premium role required (plans shown for reference)
// ═══════════════════════════════════════════════════════
function UpgradeScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { account } = useApp()
  const [plan, setPlan] = useState<PlanId | null>(null)
  return (
    <section className="screen premium-gate-screen">
      <div className="premium-gate-hero">
        <button className="ott-exit" type="button" onClick={() => navigate('/')}>← Home</button>
        <span className="premium-gate-crown"><CrownMark size={34} /></span>
        <p className="eyebrow">RedGrab Premium</p>
        <h1>Premium access</h1>
        <p>Premium/VIP access is activated by the admin on your local account. Sign in and ask the admin to upgrade your role.</p>
        <div className="premium-gate-hero__login">
          <button type="button" className="primary-button primary-button--wide" onClick={() => navigate(account ? '/you' : '/login')}>
            {account ? `Signed in as @${account.username} (${roleLabel(account.role)})` : 'Sign in to your account'}
          </button>
        </div>
        {account && <p className="form-help">Current role: {roleLabel(account.role)} · Premium/VIP role ke baad yahan content unlock ho jayega.</p>}
      </div>
      <details className="premium-plan-details">
        <summary>Plans dekhein ⭐</summary>
        <div className="premium-plan-section">
          <h2>Premium & VIP plans</h2>
          <PlanCards onPick={setPlan} />
          <p className="form-help">Access appears only after admin verification and role activation.</p>
        </div>
      </details>
      {plan && <PayQrModal plan={plan} onClose={() => setPlan(null)} />}
    </section>
  )
}

// ═══════════════════════════════════════════════════════
//  MAIN: Stack navigator
// ═══════════════════════════════════════════════════════
export function PremiumScreen(): React.JSX.Element {
  const { account } = useApp()
  const [active, setActive] = useState<CommunityChannel | null>(null)
  // Premium opens only with a local premium/vip role assigned by the admin.
  if (!hasPremiumAccess(account?.role)) return <UpgradeScreen />
  if (active) return <PremiumChatView channel={active} onBack={() => setActive(null)} />
  return <PremiumChannelList onOpen={setActive} />
}
