import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LiveError, ScreenNotice } from '../components/LiveState'
import { MediaGrid } from '../components/MediaGrid'
import { ScreenHeader } from '../components/ScreenHeader'
import { ArrowLeftIcon, RefreshIcon } from '../components/icons'
import { usePagedMedia } from '../hooks/usePagedMedia'
import { compactNumber } from '../lib/format'
import { publicMediaApi } from '../lib/redgifs'
import type { FeedOrder, Niche } from '../types'

export function NicheScreen(): React.JSX.Element {
  const { id: encodedId = '' } = useParams()
  const id = decodeURIComponent(encodedId)
  const navigate = useNavigate()
  const [order, setOrder] = useState<FeedOrder>('latest')
  const [related, setRelated] = useState<Niche[]>([])
  const feed = usePagedMedia(useCallback((page: number) => publicMediaApi.niche(id, page, order), [id, order]), [id, order])

  useEffect(() => {
    let cancelled = false
    void publicMediaApi.relatedNiches(id).then((items) => { if (!cancelled) setRelated(items) }).catch(() => { if (!cancelled) setRelated([]) })
    return () => { cancelled = true }
  }, [id])

  return (
    <section className="screen">
      <ScreenHeader title={id} eyebrow="Public niche" actions={<><button className="round-button" type="button" onClick={() => navigate(-1)} aria-label="Go back"><ArrowLeftIcon size={19} /></button><button className="round-button" type="button" onClick={() => void feed.reload()} aria-label="Refresh niche"><RefreshIcon size={19} /></button></>} />
      <div className="niche-detail-hero"><p className="eyebrow">Live V2 niche</p><h2>{id}</h2><p>Browse publicly indexed clips inside this niche. Results come from the live source endpoint.</p></div>
      {related.length > 0 && <><div className="subsection-heading subsection-heading--spaced">Related niches</div><div className="niche-row">{related.slice(0, 10).map((niche) => <button className="niche-chip" type="button" key={niche.id} onClick={() => navigate(`/niche/${encodeURIComponent(niche.id)}`)}>{niche.name} <small>{compactNumber(niche.gifs)}</small></button>)}</div></>}
      <div className="feed-toolbar creator-feed-toolbar"><div className="section-heading section-heading--inline"><div><p className="eyebrow">Niche feed</p><h3>Public clips</h3></div></div><label className="sort-control"><span className="sr-only">Sort niche results</span><select value={order} onChange={(event) => setOrder(event.target.value as FeedOrder)}><option value="latest">Latest</option><option value="score">Score</option><option value="top">Top</option></select></label></div>
      {feed.error ? <LiveError message={feed.error} onRetry={feed.reload} title="Niche clips could not load." /> : <MediaGrid items={feed.items} loading={feed.loading} canLoadMore={feed.canLoadMore} loadingMore={feed.loadingMore} onLoadMore={() => void feed.loadMore()} empty={<div className="empty-state"><strong>No public clips are available in this niche.</strong></div>} />}
      {!feed.loading && !feed.error && feed.items.length === 0 && <ScreenNotice>Try another niche or refresh the live feed.</ScreenNotice>}
    </section>
  )
}
