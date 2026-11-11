import { useContext, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClinicPicker, SpecialityPicker, Toolbar, Ui } from '../App'
import { api, fmt, isTauri, lrColor, url } from '../api'
import { I } from '../icons'

type Tab = 'best' | 'saved'

async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t) } catch {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
  }
}

export default function Library() {
  const { spec, toast } = useContext(Ui)
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem('reely.lib.tab') as Tab) || 'best')
  const [clinic, setClinic] = useState('')
  const [hookType, setHookType] = useState('')
  const [format, setFormat] = useState('')
  const [q, setQ] = useState('')
  const [best, setBest] = useState<{ hooks: any[]; facets: Record<string, string[]> } | null>(null)
  const [saved, setSaved] = useState<any[] | null>(null)

  useEffect(() => { localStorage.setItem('reely.lib.tab', tab) }, [tab])
  const loadSaved = () => api.library().then(setSaved).catch(() => setSaved([]))
  useEffect(() => { loadSaved() }, [])
  useEffect(() => {
    const p: Record<string, string> = { limit: '300' }
    if (spec) p.speciality = spec
    if (clinic) p.clinic = clinic
    if (hookType) p.hook_type = hookType
    if (format) p.format = format
    if (q) p.q = q
    api.hooks(p).then(setBest).catch(() => setBest({ hooks: [], facets: {} }))
  }, [spec, clinic, hookType, format, q])
  useEffect(() => { setClinic('') }, [spec])

  const savedSet = useMemo(() => new Set((saved || []).map(s => s.shortcode)), [saved])
  const toggle = async (code: string) => {
    if (savedSet.has(code)) {
      await api.libraryRemove([code]); await loadSaved()
      toast('Removed from the library', async () => { await api.libraryAdd([code]); loadSaved() })
    } else {
      await api.libraryAdd([code]); await loadSaved()
      toast('Saved to the library', async () => { await api.libraryRemove([code]); loadSaved() })
    }
  }
  const filterSaved = (rows: any[]) => rows.filter(r =>
    (!spec || r.speciality === spec) && (!clinic || r.clinic === clinic) && (!hookType || r.hook_type === hookType) && (!format || r.format === format)
    && (!q || `${r.hook_en} ${r.hook_original} ${r.summary} ${r.lib_note}`.toLowerCase().includes(q.toLowerCase())))
  const rows = tab === 'best' ? (best?.hooks || []) : filterSaved(saved || [])
  const exportAs = async (f: 'csv' | 'md') => {
    if (isTauri) { const r = await api.libraryExportSave(f); toast(`Saved ${r.path.split('/').pop()} to Downloads`) }
    else window.open(url(`/api/library/export?fmt=${f}`), '_blank')
  }
  const copyAll = async () => {
    await copyText(rows.map(r => `${r.hook_en || r.hook_original}\n  @${r.clinic} · ${r.format || ''} · ${r.like_rate != null ? r.like_rate.toFixed(2) + '%' : ''} · ${r.url || ''}`).join('\n\n'))
    toast(`Copied ${rows.length} hook${rows.length === 1 ? '' : 's'}`)
  }

  return (
    <>
      <Toolbar title="Hook library">
        <SpecialityPicker />
        <ClinicPicker value={clinic} onChange={setClinic} allValue="" />
        <div className="field"><select value={hookType} onChange={e => setHookType(e.target.value)} aria-label="Hook type"><option value="">Any hook type</option>{(best?.facets.hook_type || []).map(v => <option key={v} value={v}>{v}</option>)}</select></div>
        <div className="field"><select value={format} onChange={e => setFormat(e.target.value)} aria-label="Format"><option value="">Any format</option>{(best?.facets.format || []).map(v => <option key={v} value={v}>{v}</option>)}</select></div>
        <div className="field" style={{ width: 180 }}>{I.search()}<input placeholder="Search hooks and notes" value={q} onChange={e => setQ(e.target.value)} /></div>
      </Toolbar>
      <div className="main"><div className="main-inner">
        <div>
          <h1 className="large">Hook library</h1>
          <div className="lead">The openings that earned real engagement, ranked by like-rate across {spec ? `${spec} clinics` : 'every clinic'}. Star the ones worth adapting; they collect in Saved.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="seg">
            <button className={tab === 'best' ? 'on' : ''} onClick={() => setTab('best')}>Best hooks</button>
            <button className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>Saved{saved ? ` · ${saved.length}` : ''}</button>
          </div>
          <span className="caption">{rows.length} shown</span>
          <span className="spacer" />
          {rows.length > 0 && <button className="btn plain sm" onClick={copyAll}>{I.copy()} Copy {tab === 'saved' ? 'saved' : 'shown'}</button>}
          {tab === 'saved' && (saved?.length || 0) > 0 && <>
            <button className="btn plain sm" onClick={() => exportAs('md')}>{I.download()} Markdown</button>
            <button className="btn plain sm" onClick={() => exportAs('csv')}>{I.download()} CSV</button>
          </>}
        </div>
        <div className="group">
          {tab === 'best' && !best && <div className="empty">Loading…</div>}
          {rows.length === 0 && (tab === 'saved'
            ? <div className="empty">Nothing saved yet. Star a hook here, or send reels from the Reels page: tick several, use the button on the reel card, or double-click a row in the table.</div>
            : best && <div className="empty">No annotated hooks match these filters.</div>)}
          {rows.map(r => <HookRow key={r.shortcode} r={r} saved={savedSet.has(r.shortcode)} onToggle={() => toggle(r.shortcode)} showNote={tab === 'saved'} onNote={n => api.libraryNote(r.shortcode, n).then(loadSaved)} />)}
        </div>
      </div></div>
    </>
  )
}

function HookRow({ r, saved, onToggle, showNote, onNote }: { r: any; saved: boolean; onToggle: () => void; showNote: boolean; onNote: (n: string) => void }) {
  const { toast } = useContext(Ui)
  const [note, setNote] = useState(r.lib_note || '')
  const [editing, setEditing] = useState(false)
  useEffect(() => setNote(r.lib_note || ''), [r.lib_note])
  if (r.missing) return (
    <div className="hookrow"><div /><div className="fill"><div className="caption">{r.shortcode} from @{r.clinic} is no longer in the index on this Mac.</div></div>
      <button className="btn plain sm" onClick={onToggle}>Remove</button></div>
  )
  return (
    <div className="hookrow">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <b style={{ fontSize: 15, color: lrColor(r.like_rate), fontVariantNumeric: 'tabular-nums' }}>{r.like_rate != null ? r.like_rate.toFixed(2) + '%' : '—'}</b>
        <span className="caption">like-rate</span>
      </div>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div className="hk">{r.hook_en || r.hook_original}</div>
        {r.hook_original && r.hook_original !== r.hook_en && <div className="caption" style={{ fontStyle: 'italic' }}>Spoken: {r.hook_original.slice(0, 220)}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {r.hook_type && <span className="chip">{r.hook_type}</span>}
          {r.format && <span className="chip">{r.format}</span>}
          <span className="caption">@{r.clinic}{r.speciality ? ` · ${r.speciality}` : ''} · {fmt.n(r.views)} views{r.outlier ? ` · ${Math.round(r.outlier)}× median` : ''}</span>
        </div>
        {r.summary && <div className="caption" style={{ lineHeight: 1.5, color: 'var(--c-sub)' }}>{r.summary}</div>}
        {showNote && (editing
          ? <textarea className="inline" autoFocus value={note} onChange={e => setNote(e.target.value)} placeholder="How you'd adapt this hook" onBlur={() => { setEditing(false); if (note !== (r.lib_note || '')) onNote(note) }} />
          : <button className="linkbtn" style={{ alignSelf: 'flex-start', color: note ? 'var(--c-ink)' : undefined, fontWeight: note ? 400 : 600, textAlign: 'left' }} onClick={() => setEditing(true)}>{note ? <>✎ {note}</> : '+ Add a note'}</button>)}
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button className="starbtn" aria-label="Copy hook" title="Copy hook" onClick={async () => { await copyText(r.hook_en || r.hook_original); toast('Hook copied') }}>{I.copy({ width: 14, height: 14 })}</button>
        <Link className="starbtn" to={`/reels/${r.clinic}`} title="Open the clinic's reels" aria-label="Open in Reels">{I.reels({ width: 14, height: 14 })}</Link>
        <a className="starbtn" href={r.url} target="_blank" rel="noreferrer" title="Open on Instagram" aria-label="Open on Instagram">{I.ext({ width: 13, height: 13 })}</a>
        <button className={'starbtn' + (saved ? ' on' : '')} aria-pressed={saved} aria-label={saved ? 'Remove from library' : 'Save to library'} title={saved ? 'Saved · click to remove' : 'Save to library'} onClick={onToggle}>{saved ? I.starFill({ width: 16, height: 16 }) : I.star({ width: 16, height: 16 })}</button>
      </div>
    </div>
  )
}
