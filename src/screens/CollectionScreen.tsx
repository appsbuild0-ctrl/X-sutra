import { useNavigate, useParams } from 'react-router-dom'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { ArrowLeftIcon, TrashIcon } from '../components/icons'
import { useApp } from '../context/AppContext'

export function CollectionScreen(): React.JSX.Element {
  const { id: encodedId = '' } = useParams()
  const id = decodeURIComponent(encodedId)
  const navigate = useNavigate()
  const { collections, collectionItems, deleteCollection } = useApp()
  const collection = collections.find((entry) => entry.id === id)
  const items = collectionItems(id)

  if (!collection) {
    return <section className="screen"><ScreenHeader title="Collection" eyebrow="Local library" actions={<button className="round-button" type="button" onClick={() => navigate('/library')} aria-label="Back to library"><ArrowLeftIcon size={20} /></button>} /><div className="empty-state empty-state--tall"><strong>Collection not found.</strong><button className="secondary-button" type="button" onClick={() => navigate('/library')}>Back to Library</button></div></section>
  }

  return (
    <section className="screen">
      <ScreenHeader title={collection.name} eyebrow="Local collection" actions={<><button className="round-button" type="button" onClick={() => navigate('/library')} aria-label="Back to library"><ArrowLeftIcon size={20} /></button><button className="round-button" type="button" onClick={() => { deleteCollection(id); navigate('/library') }} aria-label="Delete collection"><TrashIcon size={18} /></button></>} />
      {collection.description && <p className="collection-description">{collection.description}</p>}
      <div className="section-heading"><div><p className="eyebrow">Saved public clips</p><h3>{items.length} {items.length === 1 ? 'clip' : 'clips'}</h3></div></div>
      <MediaGrid items={items} empty={<div className="empty-state empty-state--tall"><strong>This collection is empty.</strong><span>Open any saved public clip and add it from the player.</span></div>} />
    </section>
  )
}
