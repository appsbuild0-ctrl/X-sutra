import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CreatorAvatar } from '../components/CreatorAvatar'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { BookmarkIcon, ChevronRightIcon, CompassIcon, LibraryIcon, UserIcon } from '../components/icons'
import { useApp } from '../context/AppContext'

type LibraryView = 'saved' | 'likes' | 'collections' | 'following'

export function LibraryScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { saved, liked, follows, collections, createCollection } = useApp()
  const [view, setView] = useState<LibraryView>('saved')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    createCollection(name, description)
    if (name.trim()) {
      setName('')
      setDescription('')
      setCreating(false)
      setView('collections')
    }
  }

  return (
    <section className="screen">
      <ScreenHeader title="Library" eyebrow="Saved on this device" actions={<span className="count-badge">{saved.length}</span>} />
      <div className="library-hero">
        <span className="library-hero__icon"><BookmarkIcon size={22} filled /></span>
        <div><h2>Your local space.</h2><p>Saves, follows, and collections stay on this device. Public source data is never mocked.</p></div>
      </div>

      <div className="segmented library-segmented" role="tablist" aria-label="Library sections">
        <button type="button" className={view === 'saved' ? 'is-active' : ''} onClick={() => setView('saved')}>Saved</button>
        <button type="button" className={view === 'likes' ? 'is-active' : ''} onClick={() => setView('likes')}>Likes</button>
        <button type="button" className={view === 'collections' ? 'is-active' : ''} onClick={() => setView('collections')}>Collections</button>
        <button type="button" className={view === 'following' ? 'is-active' : ''} onClick={() => setView('following')}>Following</button>
      </div>

      {view === 'saved' && <>
        <div className="section-heading"><div><p className="eyebrow">Local saves</p><h3>Saved clips</h3></div>{saved.length > 0 && <span>{saved.length} clips</span>}</div>
        <MediaGrid items={saved} empty={<div className="empty-state empty-state--tall"><span className="empty-state__icon"><BookmarkIcon size={25} /></span><strong>Your library is waiting.</strong><span>Save a real public clip from any feed or player.</span><button type="button" className="secondary-button" onClick={() => navigate('/discover')}><CompassIcon size={18} /> Explore clips</button></div>} />
      </>}

      {view === 'likes' && <>
        <div className="section-heading"><div><p className="eyebrow">Local likes</p><h3>Liked clips</h3></div>{liked.length > 0 && <span>{liked.length} clips</span>}</div>
        <MediaGrid items={liked} empty={<div className="empty-state empty-state--tall"><span className="empty-state__icon"><BookmarkIcon size={25} /></span><strong>No local likes yet.</strong><span>Double-tap a video or tap Like inside the player.</span><button type="button" className="secondary-button" onClick={() => navigate('/discover')}><CompassIcon size={18} /> Browse public clips</button></div>} />
      </>}

      {view === 'collections' && <>
        <div className="section-heading"><div><p className="eyebrow">Local organization</p><h3>Collections</h3></div><button className="text-button" type="button" onClick={() => setCreating((current) => !current)}>{creating ? 'Cancel' : 'New collection'}</button></div>
        {creating && <form className="collection-form" onSubmit={submit}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Collection name" maxLength={48} autoFocus /><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description (optional)" maxLength={120} /><button className="primary-button" type="submit">Create</button></form>}
        {collections.length ? <div className="collection-list">{collections.map((collection) => <button className="collection-row" type="button" key={collection.id} onClick={() => navigate(`/collection/${encodeURIComponent(collection.id)}`)}><span className="collection-row__icon"><LibraryIcon size={19} /></span><span className="collection-row__copy"><strong>{collection.name}</strong><small>{collection.itemIds.length} {collection.itemIds.length === 1 ? 'clip' : 'clips'}{collection.description ? ` · ${collection.description}` : ''}</small></span><ChevronRightIcon size={18} /></button>)}</div> : <div className="empty-state"><strong>No local collections yet.</strong><span>Create one, then add saved real clips from the player.</span></div>}
      </>}

      {view === 'following' && <>
        <div className="section-heading"><div><p className="eyebrow">Local following list</p><h3>Following</h3></div>{follows.length > 0 && <span>{follows.length} creators</span>}</div>
        {follows.length ? <div className="creator-list">{follows.map((creator, index) => <button className="creator-row" type="button" key={creator.username} onClick={() => navigate(`/creator/${encodeURIComponent(creator.username)}`)}><CreatorAvatar src={creator.avatar} label={creator.displayName} index={index} /><span className="creator-row__copy"><strong>{creator.displayName}</strong><small>@{creator.username}</small></span><ChevronRightIcon size={18} /></button>)}</div> : <div className="empty-state empty-state--tall"><span className="empty-state__icon"><UserIcon size={24} /></span><strong>No followed creators.</strong><span>Use Follow on a public creator profile to add it here.</span></div>}
      </>}
    </section>
  )
}
