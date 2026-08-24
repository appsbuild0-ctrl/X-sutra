import { ScreenHeader } from '../components/ScreenHeader'
import { DownloadIcon, PlayIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { relativeDate } from '../lib/format'

export function PremiumDownloadsScreen(): React.JSX.Element {
  const { downloads, openPlayer } = useApp()
  const mine = downloads.filter((record) => (record.status === 'done' || record.status === 'opened') && (record.item.creator === 'premium' || record.item.id.startsWith('pm-') || record.item.id.startsWith('file-')))

  return (
    <section className="screen screen--ott">
      <ScreenHeader title="Downloads" eyebrow="Your Premium files" />
      {mine.length ? (
        <div className="download-list">
          {mine.map((record) => (
            <article className="download-row" key={record.id}>
              <button type="button" className="download-row__thumb" onClick={() => openPlayer(record.item)}>
                {record.item.thumbnail && <img src={record.item.thumbnail} alt="" />}
                <PlayIcon size={16} />
              </button>
              <button type="button" className="download-row__copy" onClick={() => openPlayer(record.item)}>
                <strong>{record.item.title}</strong>
                <span>Premium · {relativeDate(record.createdAt)}</span>
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state empty-state--tall">
          <span className="empty-state__icon"><DownloadIcon size={25} /></span>
          <strong>No downloads yet.</strong>
        </div>
      )}
    </section>
  )
}
