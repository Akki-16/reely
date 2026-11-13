import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router-dom'
import { ClinicPicker, SpecialityPicker, Toolbar, Ui, useName } from '../App'
import { api, fmt, isTauri, langName, LANGS, lrColor, url } from '../api'
import type { Reel } from '../api'
import { label } from '../categoryInfo'
import { I } from '../icons'
import SendTo from './SendTo'

const ALL = '_all'
type View = 'list' | 'table'

/** Every column the table can show. `wrap` = long text, `num` = right-aligned, `sort` = server sort key. */
const COLS: { key: keyof Reel | 'no'; label: string; wrap?: boolean; num?: boolean; sort?: string; fmt?: (r: Reel, i: number) => React.ReactNode }[] = [
  { key: 'no', label: 'No', num: true, fmt: (_, i) => i + 1 },
  { key: 'clinic', label: 'Account' },
  { key: 'speciality', label: 'Speciality' },
  { key: 'like_rate', label: 'Like-rate', num: true, sort: 'like_rate', fmt: r => <b style={{ color: lrColor(r.like_rate) }}>{fmt.pct(r.like_rate)}</b> },
  { key: 'views', label: 'Views', num: true, sort: 'views', fmt: r => <span title={r.views?.toLocaleString()}>{fmt.n(r.views)}</span> },
  { key: 'likes', label: 'Likes', num: true, fmt: r => <span title={r.likes?.toLocaleString()}>{fmt.n(r.likes)}</span> },
  { key: 'outlier', label: 'vs median', num: true, fmt: r => r.outlier != null ? r.outlier.toFixed(1) + '×' : '' },
  { key: 'hook_en', label: 'Hook (English)', wrap: true },
  { key: 'hook_type', label: 'Hook type' },
  { key: 'format', label: 'Format' },
  { key: 'flag', label: 'Flag' },
  { key: 'cta', label: 'CTA' },
  { key: 'language', label: 'Lang' },
  { key: 'duration', label: 'Length', num: true, sort: 'duration', fmt: r => fmt.dur(r.duration) },
  { key: 'date', label: 'Date', sort: 'date', fmt: r => fmt.date(r.date) },
  { key: 'summary', label: 'Notes', wrap: true },
  { key: 'hook_original', label: 'Hook (spoken)', wrap: true },
  { key: 'caption', label: 'Caption', wrap: true },
  { key: 'transcript_en', label: 'Transcript (English)', wrap: true },
  { key: 'transcript', label: 'Transcript (original)', wrap: true },
  { key: 'rank', label: 'Views rank', num: true, sort: 'rank' },
  { key: 'file_name', label: 'File' },
  { key: 'shortcode', label: 'Shortcode' },
  { key: 'url', label: 'URL', fmt: r => <a href={r.url} target="_blank" rel="noreferrer">{r.url.replace('https://www.instagram.com', '')}</a> },
]
const DEFAULT_COLS = ['like_rate', 'views', 'hook_en', 'hook_type', 'format', 'flag', 'language', 'duration', 'date']

export default function Reels() {
  const nameOf = useName()
  const { handle: hParam } = useParams()
  const { spec, clinics, toast, viewOnly, sideOpen } = useContext(Ui)
  // hook library: which reels are saved, and the ones ticked for a bulk send
  const [lib, setLib] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [selecting, setSelecting] = useState(false)   // checkboxes only show in select mode
  const loadLib = () => api.library().then(rows => setLib(new Set(rows.map(r => r.shortcode)))).catch(() => {})
  useEffect(() => { loadLib() }, [])
  const sendToLibrary = async (codes: string[]) => {
    const r = await api.libraryAdd(codes); await loadLib()
    const n = r.added.length
    if (!n) { toast(codes.length === 1 ? 'Already in the library' : 'All of these are already in the library'); return }
    toast(`${n} reel${n === 1 ? '' : 's'} added to the library${codes.length > n ? ` · ${codes.length - n} already there` : ''}`,
      async () => { await api.libraryRemove(r.added); loadLib() })
  }
  const removeFromLibrary = async (code: string) => {
    await api.libraryRemove([code]); await loadLib()
    toast('Removed from the library', async () => { await api.libraryAdd([code]); loadLib() })
  }
  const togglePick = (code: string) => setPicked(p => { const n = new Set(p); n.has(code) ? n.delete(code) : n.add(code); return n })
  const [handle, setHandle] = useState(hParam || localStorage.getItem('reely.reels.clinic') || ALL)
  const [view, setView] = useState<View>(() => (localStorage.getItem('reely.reels.view') as View) || 'list')
  const [cols, setCols] = useState<string[]>(() => { try { const c: string[] = JSON.parse(localStorage.getItem('reely.reels.cols') || ''); return c.filter(k => k !== 'rank' && k !== 'no') } catch { return DEFAULT_COLS } })
  const [saved, setSaved] = useState<string | null>(null)
  const [data, setData] = useState<{ reels: Reel[]; facets: Record<string, string[]>; total: number } | null>(null)
  const [sel, setSel] = useState<Reel | null>(null)
  const [card, setCard] = useState<'open' | 'closing' | null>(null)   // table view: the reel panel on the right edge
  const closeCard = () => { setCard('closing'); setTimeout(() => setCard(c => c === 'closing' ? null : c), 230) }
  const [sort, setSort] = useState('like_rate')
  const [minLR, setMinLR] = useState('')
  const [f, setF] = useState<Record<string, string>>({})
  const [q, setQ] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [showCols, setShowCols] = useState(false)
  const [tr, setTr] = useState<{ missing: number; job: any; target?: string } | null>(null)
  const [target, setTarget] = useState('en')
  useEffect(() => { api.settings().then(s => setTarget(s.translate_to || 'en')).catch(() => {}) }, [])

  useEffect(() => { if (hParam) setHandle(hParam) }, [hParam])
  // a clinic outside the chosen speciality falls back to "all clinics in that speciality"
  useEffect(() => { if (spec && handle !== ALL && clinics.length && clinics.find(c => c.handle === handle)?.speciality !== spec) setHandle(ALL) }, [spec, clinics])
  useEffect(() => { localStorage.setItem('reely.reels.clinic', handle) }, [handle])
  useEffect(() => { localStorage.setItem('reely.reels.view', view); setCard(null) }, [view])
  useEffect(() => { localStorage.setItem('reely.reels.cols', JSON.stringify(cols)) }, [cols])

  useEffect(() => {
    const params: Record<string, string> = { sort, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }
    if (minLR) params.min_like_rate = minLR
    if (q) params.q = q
    if (spec && handle === ALL) params.speciality = spec
    api.reels(handle, params).then(d => { setData(d); setSel(s => (s && d.reels.find(r => r.shortcode === s.shortcode)) || d.reels[0] || null) })
  }, [handle, sort, minLR, f, q, spec])

  useEffect(() => {
    if (handle === ALL) { setTr(null); return }
    let alive = true
    const poll = async () => {
      const s = await api.translateStatus(handle).catch(() => null)
      if (!alive || !s) return
      setTr(prev => { if (prev?.job?.status === 'running' && s.job?.status === 'done') setF(f => ({ ...f })); return s })
    }
    poll(); const t = setInterval(poll, 3000); return () => { alive = false; clearInterval(t) }
  }, [handle])

  const update = async (code: string, patch: Partial<Reel>) => {
    const r = await api.editReel(code, patch)
    setData(d => d && { ...d, reels: d.reels.map(x => x.shortcode === code ? r : x) })
    setSel(s => s?.shortcode === code ? r : s)
  }

  const scopeLabel = handle === ALL ? (spec ? `${spec} accounts` : 'All accounts') : nameOf(handle)
  // the running number is always the first column; it is not part of the user's column list
  const visibleCols = [COLS[0], ...cols.filter(k => k !== 'no').map(k => COLS.find(c => c.key === k)!).filter(Boolean).filter(c => (c.key !== 'clinic' && c.key !== 'speciality') || handle === ALL)]
  const exportParams: Record<string, string> = {}
  if (view === 'table') exportParams.cols = cols.filter(c => c !== 'no').join(',')
  if (spec && handle === ALL) exportParams.speciality = spec
  const exportHref = url(`/api/clinics/${handle}/export.csv?` + new URLSearchParams(exportParams))
  const exportSave = async () => { const r = await api.exportSave(handle, exportParams); setSaved(r.path.split('/').pop() || 'saved'); setTimeout(() => setSaved(null), 2500) }

  return (
    <>
      <Toolbar title="Reels">
        <SpecialityPicker />
        <ClinicPicker value={handle} onChange={setHandle} bold />
        <button className={'btn plain' + (selecting ? ' on' : '')} onClick={() => { if (selecting) setPicked(new Set()); setSelecting(!selecting) }} title={selecting ? 'Stop selecting' : 'Pick reels to send to the hook library or a client'}>{selecting ? 'Done' : 'Select'}</button>
        <div className="seg" role="group" aria-label="View">
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} title="List with inspector">{I.list()}</button>
          <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')} title="Table of all columns">{I.table()}</button>
        </div>
        <div className="seg">{[['like_rate', 'Like-rate'], ['views', 'Views'], ['date', 'Date']].map(([k, l]) => <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{l}</button>)}</div>
        <div className="field" style={{ width: 190 }}>{I.search()}<input placeholder="Search hooks, transcripts" value={q} onChange={e => setQ(e.target.value)} /></div>
        {tr && tr.job?.status === 'running' && <span className="pill amber"><span className="dot warn" />Translating {tr.job.total ? `${tr.job.done}/${tr.job.total}` : '…'}</span>}
        {tr && !viewOnly && tr.job?.status !== 'running' && tr.missing > 0 && <button className="btn plain" title={`${tr.missing} reels have no ${langName(tr.target || target)} text yet`} onClick={() => api.translate(handle).then(() => api.translateStatus(handle).then(setTr))}>Translate {tr.missing}</button>}
        <button className="btn plain" onClick={() => { setShowFilters(v => !v); setShowCols(false) }} style={showFilters ? { background: 'var(--c-tint-soft)', color: 'var(--c-tint)' } : undefined}>Filters</button>
        {view === 'table' && (
          <div style={{ position: 'relative' }}>
            <button className="btn plain" onClick={() => { setShowCols(v => !v); setShowFilters(false) }} style={showCols ? { background: 'var(--c-tint-soft)', color: 'var(--c-tint)' } : undefined}>Columns</button>
            {showCols && <ColumnChooser cols={cols} setCols={setCols} onClose={() => setShowCols(false)} />}
          </div>
        )}
        {isTauri
          ? <button className="btn plain" onClick={exportSave} title="Save a CSV to Downloads">{saved ? <>{I.check({ width: 12, height: 12 })} Saved</> : <>{I.upload()} Export</>}</button>
          : <a className="btn plain" href={exportHref} target="_blank" rel="noreferrer">{I.upload()} Export</a>}
      </Toolbar>
      <div className={'main' + (view === 'list' ? ' split' : '')}><div className="main-inner wide">
        {showFilters && (
          <div className="card rise" style={{ padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {(['format', 'hook_type', 'language', 'flag'] as const).map(k => (
              <div className="field" key={k}><select value={f[k] || ''} onChange={e => setF({ ...f, [k]: e.target.value })}><option value="">{k.replace('_', ' ')} · any</option>{(data?.facets[k] || []).map(v => <option key={v} value={v}>{k === 'language' ? langName(v) || v : label(v)}</option>)}</select></div>
            ))}
            <div className="field" style={{ width: 150 }}><span className="caption">Like-rate ≥</span><input value={minLR} onChange={e => setMinLR(e.target.value)} placeholder="0.25" style={{ width: 50 }} /></div>
            <div className="spacer" />
            <button className="btn plain sm" onClick={() => { setF({}); setMinLR(''); setQ('') }}>Clear</button>
          </div>
        )}

        {/* heading spans both columns so the list and the inspector start on the same line */}
        <div className="sechead" style={{ textTransform: 'none', fontSize: 19, fontWeight: 700, color: 'var(--c-ink)', letterSpacing: '-.02em', padding: '0 4px 0' }}>
          <span>{sort === 'like_rate' ? 'Top by like-rate' : sort === 'views' ? 'Top by views' : 'Newest first'} <span className="sub" style={{ fontWeight: 500, fontSize: 14 }}>· {scopeLabel}</span></span>
          <span className="caption" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>{data ? `${data.reels.length} of ${data.total}` : ''}</span>
        </div>

        {picked.size > 0 && (
          <div className="selbar" style={{ marginTop: -12 }}>
            <span>{picked.size} selected</span>
            <button className="linkbtn" style={{ color: '#fff', opacity: .85 }} onClick={() => setPicked(new Set((data?.reels || []).map(r => r.shortcode)))}>Select all {data?.reels.length}</button>
            <span className="spacer" />
            <SendTo codes={[...picked]} onLibrary={async () => { await sendToLibrary([...picked]); setPicked(new Set()) }} onDone={() => setPicked(new Set())} />
            <button className="btn plain sm" onClick={() => setPicked(new Set())}>Clear</button>
          </div>
        )}

        {view === 'list' ? (
          <div className="reels-layout" style={{ marginTop: -12 }}>
            <div className="group scrollcol">
              {!data && <div className="empty">Loading…</div>}
              {data?.reels.length === 0 && <div className="empty">No reels match. Clear the filters or run a reference account first.</div>}
              {data?.reels.map((r, i) => (
                <div key={r.shortcode} className={'grow click' + (sel?.shortcode === r.shortcode ? ' on' : '')} onClick={() => setSel(r)}>
                  {selecting && <input type="checkbox" className="rowcheck" aria-label="Select for the library" checked={picked.has(r.shortcode)} onClick={e => e.stopPropagation()} onChange={() => togglePick(r.shortcode)} />}
                  <div className="no">{i + 1}</div>
                  {sort === 'views'
                    ? <div className="lr" title={r.views?.toLocaleString()}>{fmt.n(r.views)}</div>
                    : <div className="lr" style={{ color: lrColor(r.like_rate) }}>{r.like_rate != null ? r.like_rate.toFixed(2) + '%' : '—'}</div>}
                  <div className="fill">
                    <div className="t" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.hook_en || r.hook_original || r.caption?.split('\n')[0] || r.shortcode}</div>
                    <div className="s">{[handle === ALL ? nameOf(r.clinic) : null, label(r.format), langName(r.language), fmt.dur(r.duration), sort === 'views' ? null : fmt.n(r.views) + ' views'].filter(Boolean).join(' · ')}{sort === 'views' && r.like_rate != null && <> · <span style={{ color: lrColor(r.like_rate), fontWeight: 600 }}>{r.like_rate.toFixed(2)}% like-rate</span></>}</div>
                  </div>
                  {lib.has(r.shortcode) && <span style={{ color: '#F5A623', display: 'flex' }} title="In the hook library">{I.starFill({ width: 13, height: 13 })}</span>}
                  {I.fwd({ className: 'chev', style: { color: sel?.shortcode === r.shortcode ? 'var(--c-tint)' : undefined } })}
                </div>
              ))}
            </div>
            {sel && <Inspector r={sel} onEdit={update} target={target} inLib={lib.has(sel.shortcode)} onLib={() => lib.has(sel.shortcode) ? removeFromLibrary(sel.shortcode) : sendToLibrary([sel.shortcode])} onReplace={nr => { setData(d => d && { ...d, reels: d.reels.map(x => x.shortcode === nr.shortcode ? nr : x) }); setSel(s => s?.shortcode === nr.shortcode ? nr : s) }} />}
          </div>
        ) : (
          <div className="card tablewrap" style={{ marginTop: -12 }}>
            <table className="tbl">
              <thead><tr>
                <th style={{ width: 28 }}>{selecting && <input type="checkbox" className="rowcheck" aria-label="Select all" checked={!!data?.reels.length && picked.size === data.reels.length} onChange={e => setPicked(e.target.checked ? new Set((data?.reels || []).map(r => r.shortcode)) : new Set())} />}</th>
                {visibleCols.map(c => <th key={c.key} className={c.sort ? 'sortable' : ''} onClick={() => c.sort && setSort(c.sort)} style={c.num ? { textAlign: 'right' } : undefined}>{c.label}{c.sort && sort === c.sort ? ' ↓' : ''}</th>)}
              </tr></thead>
              <tbody>
                {data?.reels.map((r, i) => (
                  <tr key={r.shortcode} className={sel?.shortcode === r.shortcode && card ? 'on' : ''} onClick={() => { setSel(r); setCard('open') }} onDoubleClick={e => { e.preventDefault(); window.getSelection()?.removeAllRanges(); sendToLibrary([r.shortcode]) }} title="Double-click to add to the hook library">
                    <td onClick={e => e.stopPropagation()} style={{ width: 28 }}><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{selecting && <input type="checkbox" className="rowcheck" aria-label="Select for the library" checked={picked.has(r.shortcode)} onChange={() => togglePick(r.shortcode)} />}{lib.has(r.shortcode) && <span style={{ color: '#F5A623', display: 'flex' }} title="In the hook library">{I.starFill({ width: 12, height: 12 })}</span>}</span></td>
                    {visibleCols.map(c => <td key={c.key} className={(c.wrap ? 'wrap ' : '') + (c.num ? 'num' : '')} title={!c.wrap && typeof r[c.key as keyof Reel] === 'string' ? String(r[c.key as keyof Reel]) : undefined}>{c.key === 'clinic' ? nameOf(r.clinic) : c.key === 'format' || c.key === 'hook_type' || c.key === 'flag' ? label(String(r[c.key] ?? '')) : c.fmt ? c.fmt(r, i) : String(r[c.key as keyof Reel] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {data?.reels.length === 0 && <div className="empty">No reels match.</div>}
          </div>
        )}
        {view === 'table' && card && sel && <ReelPanel list={data?.reels || []} sel={sel} setSel={setSel} closing={card === 'closing'} onClose={closeCard} withSide={sideOpen}>
          {(header) => <Inspector r={sel} onEdit={update} target={target} inLib={lib.has(sel.shortcode)} onLib={() => lib.has(sel.shortcode) ? removeFromLibrary(sel.shortcode) : sendToLibrary([sel.shortcode])}
            onReplace={nr => { setData(d => d && { ...d, reels: d.reels.map(x => x.shortcode === nr.shortcode ? nr : x) }); setSel(s => s?.shortcode === nr.shortcode ? nr : s) }} header={header} />}
        </ReelPanel>}
      </div></div>
    </>
  )
}

/** Table view: the reel opens in a full-height panel on the right edge over a dimmed page. ← → step through reels,
 *  Esc, the scrim or ✕ close it. Rendered on document.body because .main-inner animates, which breaks position: fixed. */
export function ReelPanel({ list, sel, setSel, closing, onClose, withSide, children }: { list: Reel[]; sel: Reel; setSel: (r: Reel) => void; closing: boolean; onClose: () => void; withSide: boolean; children: (header: React.ReactNode) => React.ReactNode }) {
  const i = list.findIndex(x => x.shortcode === sel.shortcode)
  const go = (d: number) => { const n = list[i + d]; if (n) setSel(n) }
  const goRef = useRef(go); goRef.current = go
  const closeRef = useRef(onClose); closeRef.current = onClose
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (['INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO'].includes(t.tagName) || t.isContentEditable)) return
      if (document.querySelector('.sheet-back')) return          // a sheet on top handles its own keys
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current() }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goRef.current(1) }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goRef.current(-1) }
    }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, [])
  // keep the row in view as the panel steps through reels
  useEffect(() => { document.querySelector('.tbl tr.on')?.scrollIntoView({ block: 'nearest' }) }, [sel.shortcode])
  const header = (
    <div className="reelpanel-head" data-tauri-drag-region>
      <button className="iconbtn" aria-label="Previous reel" disabled={i <= 0} onClick={() => go(-1)}>{I.back({ width: 13, height: 13 })}</button>
      <button className="iconbtn" aria-label="Next reel" disabled={i < 0 || i >= list.length - 1} onClick={() => go(1)}>{I.fwd({ width: 13, height: 13 })}</button>
      <span className="caption" style={{ color: 'var(--c-sub)', fontSize: 12.5 }}>{i + 1} of {list.length}</span>
      <span className="spacer" data-tauri-drag-region />
      <span className="caption hint">← → to move · Esc to close</span>
      <button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button>
    </div>
  )
  return createPortal(
    <>
      <div className={'reelscrim' + (withSide ? ' withside' : '') + (closing ? ' out' : '')} onMouseDown={onClose} aria-hidden />
      <div className={'reelpanel' + (closing ? ' out' : '')} role="dialog" aria-label="Reel">
        {children(header)}
      </div>
    </>, document.body)
}

function ColumnChooser({ cols, setCols, onClose }: { cols: string[]; setCols: (c: string[]) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.btn')) onClose() }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const hidden = COLS.filter(c => c.key !== 'no' && !cols.includes(c.key as string))
  const move = (i: number, d: -1 | 1) => { const n = [...cols]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setCols(n) }
  return (
    <div ref={ref} className="card pop">
      <div className="caption" style={{ padding: '4px 8px 6px', display: 'flex', justifyContent: 'space-between' }}><span>Shown · drag order with the arrows</span><button style={{ border: 0, background: 'none', color: 'var(--c-tint)', fontWeight: 600, cursor: 'pointer', font: 'inherit', fontSize: 12 }} onClick={() => setCols(DEFAULT_COLS)}>Reset</button></div>
      {cols.map((k, i) => { const c = COLS.find(x => x.key === k); if (!c) return null; return (
        <div className="row" key={k}>
          <input type="checkbox" checked readOnly onClick={() => setCols(cols.filter(x => x !== k))} aria-label={`Hide ${c.label}`} />
          <span className="name">{c.label}</span>
          <button onClick={() => move(i, -1)} aria-label="Move up" disabled={i === 0}>{I.up()}</button>
          <button onClick={() => move(i, 1)} aria-label="Move down" disabled={i === cols.length - 1}>{I.down()}</button>
        </div>) })}
      {hidden.length > 0 && <div className="caption" style={{ padding: '10px 8px 6px', borderTop: '1px solid var(--c-hair)', marginTop: 6 }}>Hidden</div>}
      {hidden.map(c => (
        <div className="row" key={c.key}>
          <input type="checkbox" checked={false} readOnly onClick={() => setCols([...cols, c.key as string])} aria-label={`Show ${c.label}`} />
          <span className="name" style={{ color: 'var(--c-sub)' }}>{c.label}</span>
        </div>
      ))}
    </div>
  )
}


type Tx = { language: string | null; segments: { start: number; end: number; text: string }[]; segments_en: { start: number; end: number; text: string }[]; text: string; translations: Record<string, string>; job?: { status: string; to: string; error: string | null } | null }

async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t) } catch {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
  }
}

const HOOK_SECONDS = 5

export function Inspector({ r, onEdit, target, onReplace, inLib, onLib, header }: { r: Reel; onEdit: (code: string, p: Partial<Reel>) => Promise<void>; target: string; onReplace: (r: Reel) => void; inLib: boolean; onLib: () => void; header?: React.ReactNode }) {
  const { clinics: allClinics, viewOnly } = useContext(Ui)
  const imported = allClinics.find(c => c.handle === r.clinic)?.imported
  const [dl, setDl] = useState<{ status: string; error: string | null } | null>(null)
  const [hist, setHist] = useState<{ at: string; views: number | null; likes: number | null }[]>([])
  useEffect(() => { setHist([]); api.reelHistory(r.shortcode).then(setHist).catch(() => {}) }, [r.shortcode])
  const growth = (() => {
    if (hist.length < 2) return null
    const a = hist[0], b = hist[hist.length - 1]
    const pct = (x: number | null, y: number | null) => x && y != null ? Math.round(((y - x) / x) * 100) : null
    return { since: a.at, views: pct(a.views, b.views), likes: pct(a.likes, b.likes), at: b.at }
  })()
  useEffect(() => { setDl(null); if (!r.video_file) api.reelDownloadStatus(r.shortcode).then(s => s.status !== 'idle' && setDl(s)).catch(() => {}) }, [r.shortcode])
  useEffect(() => {
    if (dl?.status !== 'running') return
    const t = setInterval(async () => {
      const s = await api.reelDownloadStatus(r.shortcode).catch(() => null)
      if (!s || s.status === 'running') return
      setDl(s); if (s.status === 'done') api.reelOne(r.shortcode).then(onReplace)
    }, 1500)
    return () => clearInterval(t)
  }, [dl?.status, r.shortcode])
  const [tx, setTx] = useState<Tx | null>(null)
  const [retx, setRetx] = useState<string>('')        // '' | 'running' | a short result to show on the button
  useEffect(() => { setRetx('') }, [r.shortcode])
  const retranscribe = async () => {
    const code = r.shortcode
    setRetx('running')
    try {
      await api.reelRetranscribe(code)
      for (;;) {
        await new Promise(res => setTimeout(res, 1500))
        const s = await api.reelRetranscribeStatus(code)
        if (s.status === 'running') continue
        if (s.status === 'error') { setRetx(s.error || 'Failed · try again'); return }
        if (s.changed) { onReplace(await api.reelOne(code)); load() }
        setRetx(s.changed ? 'Updated · transcribe again' : 'No more speech found · try again'); return
      }
    } catch (e: any) { setRetx(e.message || 'Failed · try again') }
  }
  const [openT, setOpenT] = useState(true)
  const [openC, setOpenC] = useState(false)
  const [times, setTimes] = useState(() => localStorage.getItem('reely.times') === '1')
  const [lang, setLang] = useState<string>('')            // '' = as spoken, otherwise a language code or typed name
  const [menu, setMenu] = useState(false)
  const [custom, setCustom] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [editSignal, setEditSignal] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const load = () => api.reelTranscript(r.shortcode).then(d => {
    setTx(d)
    setLang(l => (l && (d.translations[l] || l === d.language)) ? l : (d.translations[target] || d.language === target) ? target : '')
  }).catch(() => setTx({ language: r.language, segments: [], segments_en: [], text: r.transcript, translations: {} }))
  useEffect(() => { setTx(null); setMenu(false); load() }, [r.shortcode])
  useEffect(() => { localStorage.setItem('reely.times', times ? '1' : '0') }, [times])
  // poll while a translation for this reel is running
  useEffect(() => {
    if (tx?.job?.status !== 'running') return
    const t = setInterval(() => api.reelTranscript(r.shortcode).then(d => { setTx(d); if (d.job?.status === 'done') setLang(d.job.to) }).catch(() => {}), 2500)
    return () => clearInterval(t)
  }, [tx?.job?.status, r.shortcode])
  useEffect(() => {
    if (!menu) return
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [menu])

  const spoken = tx?.language || r.language
  const available = tx ? Object.keys(tx.translations).filter(k => k !== spoken) : []
  const showing = lang && lang !== spoken ? lang : ''
  const text = !tx ? '' : showing ? (tx.translations[showing] || '') : tx.text
  const segs = !tx ? [] : showing ? (showing === 'en' && tx.segments_en.length ? tx.segments_en : []) : tx.segments
  const canTimes = segs.length > 0

  // hook highlight for plain text: spoken hook on the original, fuzzy annotated hook on a translation, else the first sentence
  const parts = useMemo<[string | null, string]>(() => {
    const t = text || ''
    if (!t) return [null, t]
    const sp = r.hook_original || ''
    if (!showing && sp && t.startsWith(sp)) return [sp, t.slice(sp.length)]
    const h = (r.hook_en || '').trim()
    if (showing && h) {
      const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
      const nt = norm(t), nh = norm(h)
      if (nh && nt.startsWith(nh.slice(0, Math.min(nh.length, 24)))) { let i = 0, acc = ''; while (i < t.length && acc.length < nh.length) { acc += norm(t[i]); i++ } return [t.slice(0, i), t.slice(i)] }
    }
    const first = t.match(/^[^.!?।]+[.!?।]?/)
    return first && first[0].length < t.length ? [first[0], t.slice(first[0].length)] : [t, '']
  }, [text, showing, r.hook_original, r.hook_en])

  const seek = (t: number) => { const v = videoRef.current; if (v) { v.currentTime = t; v.play().catch(() => {}) } }
  const copy = async (what: string, t: string) => { await copyText(t); setCopied(what); setTimeout(() => setCopied(null), 1600) }
  const translate = async (to: string) => { setMenu(false); setCustom(''); const j = await api.reelTranslate(r.shortcode, to); setTx(x => x && { ...x, job: j }) }
  const hashtags = (r.caption?.match(/#[\p{L}\p{N}_]+/gu) || []).length
  const captionParts = (r.caption || '').split(/(#[\p{L}\p{N}_]+)/gu)
  const flagKind = (r.flag || '').split(';')[0]
  const job = tx?.job

  return (
    <aside className="card inspector">
      {header}
      <div key={r.shortcode} className="fade" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 14 }}>
          <div className="video" style={{ width: 112, height: 199, flexBasis: 112, position: 'relative' }}>
            {r.video_file ? <video ref={videoRef} key={r.video_file} src={url(`/api/video/${r.clinic}/${encodeURIComponent(r.video_file)}`)} controls playsInline preload="metadata" /> : <div className="novideo">
                <span>{imported && !imported.videos ? 'Video not included in the import' : 'No video on this Mac'}</span>
                {dl?.status === 'running'
                  ? <span className="caption" style={{ color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="ic spinner" style={{ width: 14, height: 14, flexBasis: 14 }}><span style={{ width: 12, height: 12, borderWidth: 1.5 }} /></span>Downloading…</span>
                  : <button className="btn sm" onClick={() => api.reelDownload(r.shortcode).then(setDl).catch(e => setDl({ status: 'error', error: e.message }))}>{I.download()} Download</button>}
                {dl?.status === 'error' && <span style={{ fontSize: 10.5, color: '#FFB4AE' }}>{dl.error}</span>}
              </div>}
            {r.duration != null && <span className="durpill">{fmt.dur(r.duration)}</span>}
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Editable value={r.hook_en} placeholder="Hook in English" onSave={v => onEdit(r.shortcode, { hook_en: v })} style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.015em', lineHeight: 1.3, color: 'var(--c-tint)' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <Editable value={r.format} placeholder="format" onSave={v => onEdit(r.shortcode, { format: v })} chip show={label} />
              <Editable value={r.hook_type} placeholder="hook type" onSave={v => onEdit(r.shortcode, { hook_type: v })} chip show={label} />
              {spoken && <span className="chip">{langName(spoken)}</span>}
              <Editable value={r.flag} placeholder="flag" onSave={v => onEdit(r.shortcode, { flag: v })} chip show={label} chipClass={flagKind === 'organic' ? 'pill green' : flagKind.includes('paid') ? 'pill red' : flagKind ? 'pill amber' : 'chip'} />
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 'auto', flexWrap: 'wrap' }}>
              <SendTo codes={[r.shortcode]} inLib={inLib} onLibrary={onLib} align="left" />
              <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, display: 'inline-flex', gap: 4, alignItems: 'center' }}>Open on Instagram {I.ext()}</a>
            </div>
          </div>
        </div>

        <div className="group" style={{ boxShadow: 'none', background: 'var(--c-bg)' }}>
          <div className="kv"><span>Like-rate</span><b style={{ color: lrColor(r.like_rate) }}>{fmt.pct(r.like_rate)}</b></div>
          <div className="kv"><span>Views</span><b title={r.views?.toLocaleString()}>{fmt.n(r.views)}</b></div>
          <div className="kv"><span>Likes</span><b title={r.likes?.toLocaleString()}>{fmt.n(r.likes)}</b></div>
          {growth && <div className="kv"><span>Since {fmt.date(growth.since)}</span><b style={{ color: 'var(--c-green)', fontWeight: 600 }}>{growth.views != null ? `views ${growth.views >= 0 ? '+' : ''}${growth.views}%` : ''}{growth.views != null && growth.likes != null ? ' · ' : ''}{growth.likes != null ? `likes ${growth.likes >= 0 ? '+' : ''}${growth.likes}%` : ''}</b></div>}
          <div className="kv"><span>vs account median</span><b style={{ color: 'var(--c-tint)' }}>{r.outlier != null ? r.outlier.toFixed(0) + '×' : '—'}</b></div>
        </div>

        {/* transcript */}
        <section className="sect">
          <button className="sect-h" aria-expanded={openT} onClick={() => setOpenT(v => !v)}>
            {openT ? I.down() : I.fwd({ width: 12, height: 12 })}<b>Transcript</b>
            <span className="caption">{showing ? langName(showing) : spoken ? langName(spoken) : ''}{segs.length ? ` · ${segs.length} line${segs.length === 1 ? '' : 's'}` : ''}</span>
          </button>
          {openT && (
            <div className="sect-b rise">
              <div className="ctrl-row">
                <button className={'btn plain sm' + (times && canTimes ? ' on' : '')} disabled={!canTimes} title={canTimes ? 'Show timestamps' : 'No timestamps for this translation'} aria-pressed={times && canTimes} onClick={() => setTimes(v => !v)}>{I.run({ width: 12, height: 12 })} Times</button>
                <div className="seg sm">
                  {spoken && <button className={!showing ? 'on' : ''} onClick={() => setLang('')}>{langName(spoken)}</button>}
                  {available.map(k => <button key={k} className={showing === k ? 'on' : ''} onClick={() => setLang(k)}>{langName(k)}</button>)}
                </div>
                <span className="spacer" />
                {!viewOnly && <div style={{ position: 'relative' }} ref={menuRef}>
                  <button className={'btn plain sm' + (menu ? ' on' : '')} onClick={() => setMenu(v => !v)} disabled={job?.status === 'running'}>{job?.status === 'running' ? <><span className="dot warn" />Translating to {langName(job.to)}…</> : <>Translate {I.down({ width: 10, height: 10 })}</>}</button>
                  {menu && (
                    <div className="card menu">
                      <div className="caption" style={{ padding: '6px 8px 4px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', fontSize: 10.5 }}>Translate this reel to</div>
                      {Object.entries(LANGS).filter(([k]) => k !== spoken).map(([k, n]) => (
                        <button key={k} className="row" onClick={() => tx?.translations[k] ? setLang(k) : translate(k)}>
                          <span>{n}</span><span className="caption" style={tx?.translations[k] ? { color: 'var(--c-green)', fontWeight: 600 } : undefined}>{tx?.translations[k] ? 'done' : k === 'en' ? 'Whisper' : 'Claude'}</span>
                        </button>
                      ))}
                      <div style={{ borderTop: '1px solid var(--c-hair)', margin: '4px 0 2px' }} />
                      <form className="row" style={{ gap: 6 }} onSubmit={e => { e.preventDefault(); if (custom.trim()) translate(custom.trim()) }}>
                        <span className="caption">Other</span>
                        <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="Type a language" aria-label="Other language" style={{ flex: 1, minWidth: 0, border: 0, background: 'var(--c-fill)', borderRadius: 6, padding: '4px 8px', font: 'inherit', fontSize: 12, color: 'inherit' }} />
                      </form>
                    </div>
                  )}
                </div>}
              </div>
              {job?.status === 'error' && <div className="err" style={{ fontSize: 12 }}>{job.error}</div>}
              {!tx && <div className="caption">Loading…</div>}
              {tx && !text && <div className="caption">{(tx as any).missing === 'not_imported' && !showing ? 'Transcript not included in the import. Download the video, then use More or Re-run on Overview to transcribe it.' : showing ? `No ${langName(showing)} text yet` : 'No speech detected'}</div>}
              {tx && text && (times && canTimes
                ? <div className="tlines">{segs.map((sg, i) => <button key={i} className={'tline' + (sg.start < HOOK_SECONDS ? ' hook' : '')} onClick={() => seek(sg.start)} title="Seek"><span className="mono">{fmt.dur(sg.start)}</span><span>{sg.text}</span></button>)}</div>
                : <div className="ttext">{parts[0] && <span className="mark">{parts[0]}</span>}{parts[1]}</div>)}
              {tx && (text || (r.video_file && !viewOnly)) && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {text && <button className="btn plain sm" onClick={() => copy('t', segs.length && times && canTimes ? segs.map(sg => `${fmt.dur(sg.start)} ${sg.text}`).join('\n') : text)}>{copied === 't' ? <>{I.check({ width: 11, height: 11 })} Copied</> : <>{I.copy()} Copy</>}</button>}
                  {text && <span className="caption">{times && canTimes ? 'Hook in colour · click a line to seek' : 'Hook in colour'}</span>}
                  <span className="spacer" />
                  {r.video_file && !viewOnly && (retx === 'running'
                    ? <span className="caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="ic spinner" style={{ width: 14, height: 14, flexBasis: 14 }}><span style={{ width: 12, height: 12, borderWidth: 1.5 }} /></span>Transcribing…</span>
                    : <button className="linkbtn" onClick={retranscribe} title="Listen to the video again and replace this transcript. Use it when speech is missing.">{retx || 'Transcribe again'}</button>)}
                </div>
              )}
            </div>
          )}
        </section>

        {/* caption */}
        <section className="sect" style={{ borderTop: '1px solid var(--c-hair)', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="sect-h" aria-expanded={openC} onClick={() => setOpenC(v => !v)} style={{ flex: 1 }}>
              {openC ? I.down() : I.fwd({ width: 12, height: 12 })}<b>Caption</b>
              <span className="caption">{r.caption ? `${r.caption.length} chars${hashtags ? ` · ${hashtags} hashtag${hashtags === 1 ? '' : 's'}` : ''}` : 'none'}</span>
            </button>
            {openC && r.caption && <button className="btn plain sm" onClick={() => copy('c', r.caption)}>{copied === 'c' ? <>{I.check({ width: 11, height: 11 })} Copied</> : <>{I.copy()} Copy</>}</button>}
          </div>
          {openC && <div className="sect-b rise"><div className="ttext">{captionParts.map((p, i) => p.startsWith('#') ? <span key={i} className="hashtag">{p}</span> : p)}</div></div>}
        </section>

        {/* notes + CTA */}
        <div className="notebox">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="ic tint" style={{ width: 22, height: 22, borderRadius: 7, flexBasis: 22 }}>{I.spark({ width: 12, height: 12 })}</span>
            <b style={{ fontSize: 12.5 }}>Notes</b>
            <span className="caption">{r.edited ? 'Claude · edited by you' : 'Claude'}</span>
            <span className="spacer" />
            <button className="linkbtn" onClick={() => setEditSignal(n => n + 1)}>Edit</button>
          </div>
          <Editable value={r.summary} placeholder="Why it worked, in a line or two" onSave={v => onEdit(r.shortcode, { summary: v })} multiline editSignal={editSignal} style={{ fontSize: 12.5, lineHeight: 1.55 }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', borderTop: '1px solid var(--c-hair)', paddingTop: 8 }}>
            <span className="caption" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', fontSize: 10.5 }}>CTA</span>
            <Editable value={r.cta} placeholder="none" onSave={v => onEdit(r.shortcode, { cta: v })} style={{ fontSize: 12.5 }} />
          </div>
        </div>
      </div>
    </aside>
  )
}

function Editable({ value, placeholder, onSave, chip, chipClass, multiline, style, editSignal, show }: { value: string; placeholder: string; onSave: (v: string) => Promise<void>; show?: (v: string) => string; chip?: boolean; chipClass?: string; multiline?: boolean; style?: React.CSSProperties; editSignal?: number }) {
  const [editing, setEditing] = useState(false)
  const shown = (x: string) => show && x ? show(x) : x
  const [v, setV] = useState(shown(value || ''))
  useEffect(() => setV(shown(value || '')), [value])
  useEffect(() => { if (editSignal) setEditing(true) }, [editSignal])
  const commit = async () => { setEditing(false); if (v !== shown(value || '')) await onSave(v) }
  if (editing) {
    return multiline
      ? <textarea className="inline" autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Escape') { setV(value || ''); setEditing(false) } }} />
      : <input autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setV(value || ''); setEditing(false) } }} style={{ ...style, border: '1px solid var(--c-tint)', borderRadius: 8, padding: '4px 8px', background: 'var(--c-card)', width: chip ? 140 : '100%' }} />
  }
  if (chip) return <button className={chipClass || 'chip'} style={{ border: 0, cursor: 'text', opacity: value ? 1 : .6 }} onClick={() => setEditing(true)} title="Click to edit">{value ? (show ? show(value) : value) : placeholder}</button>
  return <div className="editable" style={style} onClick={() => setEditing(true)} title="Click to edit">{value || <span className="caption">{placeholder}</span>}</div>
}
