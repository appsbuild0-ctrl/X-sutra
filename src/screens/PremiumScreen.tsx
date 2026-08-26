import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PayQrModal, PlanCards, type PlanId } from '../components/PlanPay'
import { TelegramAdminCard } from '../components/TelegramAdminCard'
import { SearchIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { fetchPremiumCatalog, type PremiumCatalog, type PremiumChannel, type PremiumMedia } from '../lib/premium'
import { fetchTelegramChannels, fetchTelegramStatus, type TelegramChannelRow } from '../lib/telegramAdmin'
import { hasPremiumAccess, roleLabel } from '../lib/roles'

function shortDate(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function channelEmoji(channel: PremiumChannel): string {
  if (channel.type === 'videos') return '🎬'
  if (channel.type === 'images') return '📸'
  return '🔥'
}

function ChannelRow({ channel, media, onOpen }: { channel: PremiumChannel; media: PremiumMedia[]; onOpen: () => void }): React.JSX.Element {
  const latest = [...media].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
  const previews = media.filter((item) => item.thumbnail || item.type === 'image').slice(0, 3)
  const videos = media.filter((item) => item.type === 'video').length
  const label = media.length > 1 ? `${media.length} media` : videos ? 'Video' : media.length ? 'Photo' : 'No media yet'

  return (
    <button className="tg-channel-row" type="button" onClick={onOpen}>
      <span className="tg-channel-avatar">
        {channel.cover ? <img src={channel.cover} alt="" /> : channelEmoji(channel)}
      </span>
      <span className="tg-channel-main">
        <span className="tg-channel-top">
          <strong>{channel.name}</strong>
          <span className="tg-channel-date"><i>✓✓</i>{shortDate(latest?.createdAt || channel.createdAt)}</span>
        </span>
        <span className="tg-channel-preview">
          <b>You:</b>
          {previews.length > 0 && <span className="tg-mini-thumbs">{previews.map((item) => <img key={item.id} src={item.thumbnail || item.url} alt="" loading="lazy" />)}</span>}
          <span>{label}</span>
          {media.length > 0 && <em>{Math.min(media.length, 99)}</em>}
        </span>
      </span>
    </button>
  )
}

function PremiumInbox(): React.JSX.Element {
  const navigate = useNavigate()
  const { account } = useApp()
  const [catalog, setCatalog] = useState<PremiumCatalog | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [telegramConnected, setTelegramConnected] = useState<boolean | null>(null)
  const [telegramChannels, setTelegramChannels] = useState<TelegramChannelRow[]>([])

  useEffect(() => {
    void fetchPremiumCatalog().then(setCatalog).catch((reason) => setError(reason instanceof Error ? reason.message : 'Channels could not load.'))
    void fetchTelegramStatus().then((status) => {
      setTelegramConnected(status.connection.connected)
      if (status.connection.connected) void fetchTelegramChannels().then(setTelegramChannels)
    }).catch(() => setTelegramConnected(false))
  }, [])

  const channels = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (catalog?.channels ?? [])
      .filter((channel) => channel.status === 'on')
      .filter((channel) => !needle || channel.name.toLowerCase().includes(needle) || channel.description.toLowerCase().includes(needle) || channel.type.includes(needle))
      .sort((a, b) => a.order - b.order)
  }, [catalog, query])

  const categories = useMemo(() => Array.from(new Set((catalog?.channels ?? []).filter((channel) => channel.status === 'on').map((channel) => channel.type))), [catalog])

  const reloadTelegram = (): void => {
    void fetchTelegramStatus().then((status) => {
      setTelegramConnected(status.connection.connected)
      if (status.connection.connected) void fetchTelegramChannels().then(setTelegramChannels)
      else setTelegramChannels([])
    }).catch(() => setTelegramConnected(false))
  }

  return (
    <section className="screen tg-premium-screen">
      <header className="tg-premium-header">
        <div><span className="tg-logo">X</span><div><h1>X-Sutra</h1><small>{roleLabel(account?.role)} channels</small></div></div>
        <button type="button" onClick={() => navigate('/you')} aria-label="Profile">{account?.name?.slice(0, 1).toUpperCase() || 'P'}</button>
      </header>

      <label className="tg-search"><SearchIcon size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search channels and categories" /></label>

      {telegramConnected === false && (
        <div className="tg-telegram-connect">
          <TelegramAdminCard onChanged={reloadTelegram} />
        </div>
      )}

      {telegramConnected === true && telegramChannels.length > 0 && (
        <>
          <div className="tg-list-title"><strong>🔐 Telegram sources</strong><span>{telegramChannels.length}</span></div>
          <div className="tg-channel-list">
            {telegramChannels.map((channel) => (
              <div className="tg-channel-row" key={channel.id} role="listitem">
                <span className="tg-channel-avatar">🔐</span>
                <span className="tg-channel-main">
                  <span className="tg-channel-top"><strong>{channel.title}</strong></span>
                  <span className="tg-channel-preview"><span>{channel.category}</span><em>{channel.media_count}</em></span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {categories.length > 0 && <div className="tg-category-strip">{categories.map((category) => <button key={category} type="button" onClick={() => setQuery(category)}>{category === 'videos' ? '🎬' : category === 'images' ? '📸' : '🗂️'} {category}</button>)}</div>}

      <div className="tg-list-title"><strong>Channels</strong><span>{channels.length}</span></div>
      <div className="tg-channel-list">
        {!catalog && !error && Array.from({ length: 5 }, (_, index) => <div className="tg-channel-skeleton" key={index}><i /><span /></div>)}
        {error && <div className="tg-inbox-empty"><strong>Could not load channels</strong><p>{error}</p><button className="secondary-button" type="button" onClick={() => window.location.reload()}>Retry</button></div>}
        {catalog && channels.map((channel) => <ChannelRow key={channel.id} channel={channel} media={catalog.media.filter((item) => item.channelId === channel.id)} onOpen={() => navigate(`/premium/channel/${channel.id}`)} />)}
        {catalog && channels.length === 0 && <div className="tg-inbox-empty"><span>📭</span><strong>{query ? 'No matching channels' : 'No channels published yet'}</strong><p>{query ? 'Try another channel name or category.' : 'New channels published by X-Sutra will appear here.'}</p></div>}
      </div>
      <p className="tg-private-note">🔒 Protected X-Sutra feed · Private source details are never shown</p>
    </section>
  )
}

function UpgradeScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { account } = useApp()
  const [plan, setPlan] = useState<PlanId | null>(null)
  return (
    <section className="screen premium-gate-screen">
      <div className="premium-gate-hero">
        <button className="ott-exit" type="button" onClick={() => navigate('/')}>← Home</button><span className="premium-gate-crown">⭐</span>
        <p className="eyebrow">X-Sutra membership</p><h1>Unlock Premium</h1>
        <p>Private channels and protected media stay hidden until your account is activated.</p>
        {account ? <span className="premium-status-chip">Current status · {roleLabel(account.role)}</span> : <button className="primary-button" type="button" onClick={() => navigate('/login')}>Login or create account</button>}
      </div>
      <div className="premium-plan-section"><p className="eyebrow">Choose your access</p><h2>Premium & VIP plans</h2><PlanCards onPick={setPlan} /><p className="form-help">Access appears only after admin verification and role activation.</p></div>
      {plan && <PayQrModal plan={plan} onClose={() => setPlan(null)} />}
    </section>
  )
}

export function PremiumScreen(): React.JSX.Element {
  const { account } = useApp()
  return hasPremiumAccess(account?.role) ? <PremiumInbox /> : <UpgradeScreen />
}
