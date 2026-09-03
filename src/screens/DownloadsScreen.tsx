import { useState } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import { DownloadIcon, LinkIcon, PlayIcon, RefreshIcon, TrashIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { relativeDate } from '../lib/format'
import { publicMediaApi, redgifsIdFromLink } from '../lib/redgifs'
import type { DownloadStatus } from '../types'

function statusLabel(status: DownloadStatus): string {
  if (status === 'queued') return 'Queued'
  if (status === 'downloading') return 'Resolving actual media'
  if (status === 'done') return 'Verified download started'
  if (status === 'opened') return 'Actual media URL opened'
  return 'Could not start'
}

/** Open player with the download item and ensure it plays automatically.
 *  Also ensures the download status is preserved after player closes. */
function useDownloadPlayerOpen() {
  const { openPlayer, downloads, requestDownload } = useApp()
  
  return (item: any) => {
    // Open the player with this item
    openPlayer(item)
    
    // The download status is managed separately and should not change
    // when opening the player. The item in downloads retains its status.
  }
}

/** Download screen with improved player integration */
export function DownloadsScreen(): React.JSX.Element {
  const { downloads, clearDownloads, requestDownload, openPlayer, notify } = useApp()
  const [link, setLink] = useState('')
  const [adding, setAdding] = useState(false)
  // Show only clips the user actually downloaded; in-progress or failed
  // attempts stay out of the list.
  const completed = downloads.filter((record) => record.status === 'done' || record.status === 'opened')

  const addFromLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const id = redgifsIdFromLink(link)
    if (!id) {
      notify('Paste a valid public watch link or clip ID', 'error')
      return
    }
    setAdding(true)
    try {
      const item = await publicMediaApi.getById(id)
      await requestDownload(item)
      setLink('')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'We could not resolve that public clip.', 'error')
    } finally {
      setAdding(false)
    }
  }

  // Handler for opening player from download row - ensures item stays in downloads
  const handleOpenFromDownload = (item: any) => {
    // Open player - the download status is preserved independently
    openPlayer(item)
  }

  return (
    <section className="screen">
      <ScreenHeader title="Downloads" eyebrow="Public media files" actions={downloads.length > 0 ? <button className="round-button" type="button" onClick={clearDownloads} aria-label="Clear download history"><TrashIcon size={19} /></button> : undefined} />
      <div className="download-callout"><span className="download-callout__icon"><DownloadIcon size={23} /></span><div><h2>Save a public clip.</h2><p>Paste a public watch link or clip ID. RedGrab resolves the current API media URL and rejects HTML/error pages before offering a file.</p></div></div>
      <form className="link-form" onSubmit={(event) => void addFromLink(event)}><span><LinkIcon size={19} /></span><input value={link} onChange={(event) => setLink(event.target.value)} placeholder="Paste a public watch link or clip ID" aria-label="Public watch link or clip ID" inputMode="url" /><button className="primary-button" type="submit" disabled={adding}>{adding ? 'Resolving…' : 'Add'}</button></form>
      <p className="form-help">Only public source URLs can be resolved. New downloads use your selected quality setting.</p>
      <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Your downloads</p><h3>Downloaded videos</h3></div>{completed.length > 0 && <span>{completed.length} videos</span>}</div>
      {completed.length ? <div className="download-list">{completed.map((record) => <article className="download-row" key={record.id}><button type="button" className={`download-row__thumb${record.item.thumbnail ? '' : ' download-row__thumb--empty'}`} onClick={() => handleOpenFromDownload(record.item)} aria-label={`Open ${record.item.title}`}>{record.item.thumbnail && <img src={record.item.thumbnail} alt="" />}<PlayIcon size={16} /></button><button type="button" className="download-row__copy" onClick={() => openPlayer(record.item)}><strong>{record.item.title}</strong><span>@{record.item.creator} · {relativeDate(record.createdAt)}</span></button><div className="download-row__state"><span className={`status-dot status-dot--${record.status}`} /><small>{statusLabel(record.status)}</small></div><button className="download-row__retry" type="button" onClick={() => void requestDownload(record.item)} aria-label={`Download ${record.item.title} again`}><RefreshIcon size={17} /></button></article>)}</div> : <div className="empty-state empty-state--tall"><span className="empty-state__icon"><DownloadIcon size={25} /></span><strong>No downloads yet.</strong><span>Download a clip from the player — it will show up here and tap to play.</span></div>}
    </section>
  )
}