import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { BookmarkIcon, CompassIcon } from '../components/icons'
import { useApp } from '../context/AppContext'

interface LibraryScreenProps {
  onExplore: () => void
}

export function LibraryScreen({ onExplore }: LibraryScreenProps): React.JSX.Element {
  const { saved } = useApp()

  return (
    <section className="screen">
      <ScreenHeader
        title="Library"
        eyebrow="Stored on this device"
        actions={<span className="count-badge">{saved.length}</span>}
      />

      <div className="library-hero">
        <span className="library-hero__icon"><BookmarkIcon size={22} filled /></span>
        <div>
          <h2>Your saved space.</h2>
          <p>Anything you bookmark stays here locally, with no external account required.</p>
        </div>
      </div>

      <div className="section-heading">
        <div>
          <p className="eyebrow">Local collection</p>
          <h3>Saved clips</h3>
        </div>
        {saved.length > 0 && <span>{saved.length} {saved.length === 1 ? 'clip' : 'clips'}</span>}
      </div>

      <MediaGrid
        items={saved}
        empty={
          <div className="empty-state empty-state--tall">
            <span className="empty-state__icon"><BookmarkIcon size={25} /></span>
            <strong>Your library is waiting.</strong>
            <span>Tap the bookmark on any clip to save it locally.</span>
            <button type="button" className="secondary-button" onClick={onExplore}><CompassIcon size={18} /> Explore clips</button>
          </div>
        }
      />
    </section>
  )
}
