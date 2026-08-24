import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScreenHeader } from '../components/ScreenHeader'
import { ArrowLeftIcon, CheckIcon, SettingsIcon } from '../components/icons'
import { useApp } from '../context/AppContext'

export function SettingsScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const { preferences, updatePreferences, notify } = useApp()
  const [tag, setTag] = useState('')

  const addBlockedTag = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const clean = tag.trim().replace(/^#/, '').toLowerCase()
    if (!clean) return
    if (preferences.blockedTags.includes(clean)) {
      notify('That tag is already blocked')
      return
    }
    updatePreferences({ blockedTags: [...preferences.blockedTags, clean] })
    setTag('')
    notify(`#${clean} is now hidden from feeds`, 'success')
  }

  return (
    <section className="screen screen--you">
      <ScreenHeader title="Settings" eyebrow="On this device" actions={<button className="round-button" type="button" onClick={() => navigate(-1)} aria-label="Go back"><ArrowLeftIcon size={19} /></button>} />
      <div className="settings-card">
        <label className="setting-row"><span><strong>Download quality</strong><small>Used for each new public video download</small></span><select value={preferences.quality} onChange={(event) => updatePreferences({ quality: event.target.value as 'hd' | 'sd' })}><option value="hd">HD</option><option value="sd">SD</option></select></label>
        <label className="setting-row"><span><strong>Mute on open</strong><small>Open player videos muted by default</small></span><input className="switch" type="checkbox" checked={preferences.muted} onChange={(event) => updatePreferences({ muted: event.target.checked })} aria-label="Mute player videos" /></label>
      </div>
      <div className="section-heading section-heading--spaced"><div><p className="eyebrow">Feed filter</p><h3>Blocked tags</h3></div><span>{preferences.blockedTags.length} hidden</span></div>
      <form className="blocked-tag-form" onSubmit={addBlockedTag}><input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Tag to hide" aria-label="Tag to hide" /><button className="primary-button" type="submit">Block</button></form>
      {preferences.blockedTags.length ? <div className="blocked-tag-list">{preferences.blockedTags.map((blockedTag) => <button type="button" key={blockedTag} onClick={() => updatePreferences({ blockedTags: preferences.blockedTags.filter((entry) => entry !== blockedTag) })}>#{blockedTag} <span>×</span></button>)}</div> : <div className="empty-state"><strong>No blocked tags.</strong><span>Blocked tags are hidden from the Home feed on this device only.</span></div>}
      <div className="settings-card settings-card--about"><div className="about-row"><SettingsIcon size={23} /><span><strong>Public-data mode</strong><small>Real API source, no mock data</small></span></div><p><CheckIcon size={14} /> Browser builds use the public proxy; Android uses native HTTP. Both request only temporary anonymous access, and X-sutra stores no external credentials.</p></div>
    </section>
  )
}
