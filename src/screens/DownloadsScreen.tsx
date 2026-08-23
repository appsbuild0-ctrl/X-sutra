import { useState } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import { DownloadIcon, LinkIcon, PlayIcon, RefreshIcon, TrashIcon } from '../components/icons'
import { useApp } from '../context/AppContext'
import { relativeDate } from '../lib/format'
import { publicMediaApi, redgifsIdFromLink } from '../lib/redgifs'
import type { DownloadStatus } from '../types'

function statusLabel(status: DownloadStatus): string {
  if (status === 'queued') return 'Queued'
  if (status === 'downloading') return 'Starting download'
  if (status === 'done') return 'Sent to device'
  return 'Could not start'
}

export function DownloadsScreen(): React.JSX.Element {
  const { downloads, clearDownloads, requestDownload, openPlayer, notify } = useApp()
  const [link, setLink] = useState('')
  const [adding, setAdding] = useState(false)

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

  return (
    <section className="screen">
      <ScreenHeader title="Downloads" eyebrow="Public media files" actions={downloads.length > 0 ? <button className="round-button" type="button" onClick={clearDownloads} aria-label="Clear download history"><TrashIcon size={19} /></button> : undefined} />
      <div className="download-callout"><span className="download-callout__icon"><DownloadIcon size={23} /></span><div><h2>Save a public clip.</h2><p>Paste a public watch link or clip ID. X-sutra resolves real source data before it opens a download.</p></div></div>
      <form className="link-form" onSubmit={(event) => void addFromLink(event)}><span><LinkIcon size={19} /></span><input value={link} onChange={(event) => setLink(event.target.value)} placeholder="Paste a public watch link or clip ID" aria-label="Public watch link or clip ID" inputMode="url" /><button className="primary-button" type="submit" disabled={adding}>{adding ? 'Resolving…' : 'Add'}</button></form>
      <p className="form-help">Only public source URLs can be resolved. New downloads use your selected quality setting.</p>
      <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Local history</p><h3>Recent downloads</h3></div>{downloads.length > 0 && <span>{downloads.length} items</span>}</div>
      {downloads.length ? <div className="download-list">{downloads.map((record) => <article className="download-row" key={record.id}><button type="button" className={`download-row__thumb${record.item.thumbnail ? '' : ' download-row__thumb--empty'}`} onClick={() => openPlayer(record.item)} aria-label={`Open ${record.item.title}`}>{record.item.thumbnail && <img src={record.item.thumbnail} alt="" />}<PlayIcon size={16} /></button><button type="button" className="download-row__copy" onClick={() => openPlayer(record.item)}><strong>{record.item.title}</strong><span>@{record.item.creator} · {relativeDate(record.createdAt)}</span></button><div className="download-row__state"><span className={`status-dot status-dot--${record.status}`} /><small>{statusLabel(record.status)}</small></div><button className="download-row__retry" type="button" onClick={() => void requestDownload(record.item)} aria-label={`Download ${record.item.title} again`}><RefreshIcon size={17} /></button></article>)}</div> : <div className="empty-state empty-state--tall"><span className="empty-state__icon"><DownloadIcon size={25} /></span><strong>No downloads yet.</strong><span>Use the live link resolver above or Download from the player.</span></div>}
    </section>
  )
}
