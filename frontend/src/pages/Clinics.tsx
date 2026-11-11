import { useContext, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClinicPicker, HoldButton, SpecialityPicker, Toolbar, Ui } from '../App'
import { api, fmt } from '../api'
import type { Clinic } from '../api'
import { I } from '../icons'
import { ExportSheet, ImportSheet, Sheet } from './Transfer'

export default function Clinics({ onRun }: { onRun: (runId: number) => void }) {
  const { viewOnly } = useContext(Ui)
  const { spec, specialities, refreshClinics } = useContext(Ui)
  const [data, setData] = useState<any>(null)
  const [handle, setHandle] = useState('')
  const [newSpec, setNewSpec] = useState(spec)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'done' | 'running'>('all')
  const [sheet, setSheet] = useState<'export' | 'import' | null>(null)
  const [only, setOnly] = useState('')

  const load = () => api.overview().then(d => { setData(d); refreshClinics() }).catch(e => setErr(e.message))
  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id) }, [])
  useEffect(() => { setNewSpec(spec); setOnly('') }, [spec])

  const handles = handle.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean)
  const add = async () => {
    if (!handles.length) return
    setBusy(true); setErr(null)
    try {
      if (handles.length === 1) {
        const r = await api.addClinic(handles[0], newSpec || null)
        setHandle('')
        if (r.run_id) onRun(r.run_id); else load()
      } else {
        const r = await api.queueAdd(handles, newSpec || null)
        const bad = r.added.filter(x => x.error)
        setHandle(''); load()
        if (bad.length) setErr(bad.map(b => `${b.handle || b.input}: ${b.error}`).join(' · '))
      }
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  const all: Clinic[] = data?.clinics || []
  const inSpec = all.filter(c => !spec || c.speciality === spec)
  const clinics = inSpec
    .filter(c => !only || c.handle === only)
    .filter(c => filter === 'all' || (filter === 'done' ? c.status === 'done' : ['running', 'queued', 'paused'].includes(c.status)))
  const t = data?.totals
  const s = data?.settings || {}
  const sum = (k: 'reels_total' | 'analysed') => inSpec.reduce((a, c) => a + ((c as any)[k] || 0), 0)

  return (
    <>
      <Toolbar title="Overview">
        <SpecialityPicker />
        <ClinicPicker value={only} onChange={setOnly} allValue="" />
        <div className="seg">{(['all', 'done', 'running'] as const).map(f => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}</div>
        <button className="btn plain" onClick={() => setSheet('import')} title="Bring in clinics exported from another Mac">{I.download()} Import</button>
        <button className="btn plain" onClick={() => setSheet('export')} title="Pack clinics into one file for another Mac" disabled={!data?.clinics?.length}>{I.upload()} Export</button>
      </Toolbar>
      {sheet === 'export' && <ExportSheet onClose={() => setSheet(null)} />}
      {sheet === 'import' && <ImportSheet onClose={() => setSheet(null)} onDone={load} />}
      <div className="main"><div className="main-inner">
        <div>
          <h1 className="large">{spec ? spec : 'Overview'}</h1>
          <div className="lead">{t ? `${inSpec.length} clinic${inSpec.length === 1 ? '' : 's'}${spec ? ' in this speciality' : ' indexed'}. ${sum('reels_total').toLocaleString()} reels, ${sum('analysed')} analysed${spec ? '' : `, ${fmt.bytes(t.video_bytes)} on disk`}.` : 'Loading…'}</div>
        </div>
        {err && <div className="err">{err}</div>}

        {viewOnly ? (
          <div className="notebox" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <div className="ic tint" style={{ width: 32, height: 32 }}>{I.info({ width: 15, height: 15 })}</div>
            <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}><b>This Mac is view-only.</b> Browse, edit, export and import clinics here. To add clinics or analyse more reels, run Reely on an Apple Silicon Mac, export, and import the file here.</div>
            <button className="btn plain" onClick={() => setSheet('import')}>{I.download()} Import</button>
          </div>
        ) : (
        <div className="card pad" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="ic tint" style={{ width: 34, height: 34, borderRadius: 10, fontSize: 20, flexBasis: 34 }}>+</div>
          <div className="field" style={{ flex: 1, minWidth: 220, height: 34 }}>
            {I.search()}
            <input placeholder="Handles or profile URLs · paste several to queue them" value={handle} onChange={e => setHandle(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          </div>
          <div className="field" style={{ height: 34, width: 220 }}>
            <SpecInput value={newSpec} onChange={setNewSpec} options={specialities} placeholder="Speciality · pick or type" onEnter={add} />
          </div>
          <button className="btn" onClick={add} disabled={busy || !handles.length}>{busy ? 'Starting…' : handles.length > 1 ? `Queue ${handles.length} clinics` : 'Add & Run'}</button>
        </div>
        )}

        <QueuePanel />

        <div className="grid3">
          <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b className="sub" style={{ color: 'var(--c-ink)' }}>Reels indexed</b><div className="ic tint" style={{ width: 30, height: 30 }}>{I.reels({ width: 15, height: 15 })}</div></div>
            <div className="big">{t ? sum('reels_total').toLocaleString() : '—'}</div>
            <div className="caption">Across {inSpec.length} clinic{inSpec.length === 1 ? '' : 's'}{spec ? ` · ${spec}` : ''}</div>
          </div>
          <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b className="sub" style={{ color: 'var(--c-ink)' }}>Analysed</b><div className="ic green" style={{ width: 30, height: 30 }}>{I.check({ width: 15, height: 15 })}</div></div>
            <div className="big">{t ? sum('analysed') : '—'}</div>
            <div className="caption">Downloaded, transcribed and annotated</div>
          </div>
          <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--c-tint)', color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ fontSize: 13 }}>Disk free</b></div>
            <div className="big">{t ? fmt.bytes(t.free_bytes) : '—'}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.75)' }}>Videos average 2 MB each at 360p</div>
          </div>
        </div>

        <div>
          <div className="sechead" style={{ textTransform: 'none', fontSize: 19, fontWeight: 700, color: 'var(--c-ink)', letterSpacing: '-.02em' }}>{spec ? `${spec} clinics` : 'Your clinics'}<Link to="/run" className="sub" style={{ color: 'var(--c-tint)', fontWeight: 500, fontSize: 13 }}>All runs</Link></div>
          <div className="group" style={{ overflow: 'visible' }}>
            {clinics.map(c => <ClinicRow key={c.handle} c={c} specialities={specialities} showSpec={!spec} onChange={load} onRun={onRun} />)}
            {clinics.length === 0 && all.length > 0 && <div className="empty">No clinics match these filters.</div>}
            {!viewOnly && <div className="grow">
              <div className="ic" style={{ border: '1.5px dashed var(--c-fill2)', background: 'transparent', color: 'var(--c-muted)', fontSize: 20 }}>+</div>
              <div className="fill"><div className="t" style={{ color: 'var(--c-muted)' }}>Add a clinic</div><div className="s" style={{ color: 'var(--c-muted)' }}>Paste one or several Instagram handles above and pick their speciality</div></div>
            </div>}
          </div>
        </div>

        <StoragePanel clinics={inSpec.map(c => c.handle)} onChange={load} />

        <div className="grid2">
          <div>
            <div className="sechead">Recent runs</div>
            <div className="group">
              {(data?.recent_runs || []).length === 0 && <div className="grow"><div className="fill sub">No runs yet</div></div>}
              {(data?.recent_runs || []).map((r: any) => (
                <Link key={r.id} to={`/run/${r.id}`} className="grow click" style={{ color: 'inherit', padding: '11px 16px' }}>
                  <div className="fill" style={{ fontSize: 13 }}>{r.clinic} <span className="caption">· {r.status}{r.stage ? ` · ${r.stage}` : ''}</span></div>
                  <div className="caption">{fmt.date(r.started)} {fmt.time(r.started)}</div>
                  {I.fwd({ className: 'chev', width: 12, height: 12 })}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <div className="sechead">Defaults for new runs<Link to="/models" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>Change</Link></div>
            <div className="group">
              {[['Scrape', s.scrape_max && s.scrape_max !== '0' ? `Newest ${s.scrape_max}` : 'All reels'], ['Analyse', s.top_n === '100000' ? 'All scraped' : `Top ${s.top_n} by views`], ['Whisper model', `${s.whisper_model}${s.whisper_engine === 'whisper.cpp' ? ' · Metal' : ''}`], ['Video quality', s.video_quality === 'low' ? '360p · low' : 'Best available'], ['English translation', s.translate === '1' ? 'On' : 'Off'], ['Annotation', s.annotation_mode === 'cli' ? 'Claude CLI' : s.annotation_mode === 'handoff' ? 'Hand-off file' : 'Off']].map(([k, v]) => (
                <div key={k} className="grow" style={{ padding: '11px 16px' }}><div className="fill" style={{ fontSize: 13 }}>{k}</div><div className="sub">{v}</div></div>
              ))}
            </div>
          </div>
        </div>
      </div></div>
    </>
  )
}

function ClinicRow({ c, specialities, showSpec, onChange, onRun }: { c: Clinic; specialities: string[]; showSpec: boolean; onChange: () => void; onRun: (id: number) => void }) {
  const { viewOnly } = useContext(Ui)
  const [busy, setBusy] = useState(false)
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const save = async (v: string) => { setTyping(false); if ((v || null) !== (c.speciality || null)) { await api.editClinic(c.handle, { speciality: v.trim() || null }); onChange() } }
  const [failOpen, setFailOpen] = useState(false)
  const active = ['running', 'queued', 'paused'].includes(c.status)
  const status = c.status === 'done' ? <span className="pill green"><span className="dot" />Done</span>
    : c.status === 'queued' ? <span className="pill grey" title={c.waiting || 'Queued'}><span className="dot off" />Queued</span>
    : c.status === 'paused' ? <span className="pill amber">Paused</span>
    : c.status === 'running' ? <span className="pill amber" title={c.waiting || ''}><span className="dot warn" />{c.waiting ? 'Waiting' : 'Running'}</span>
    : c.status === 'failed' ? <span className="pill red"><span className="dot bad" />Failed</span>
    : c.status === 'stopped' ? <span className="pill grey">Stopped</span> : <span className="pill grey">Not run</span>
  const run = async () => {
    setBusy(true)
    try { const r = await api.startRun(c.handle); onRun(r.run_id) } catch (e: any) { alert(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="grow">
      <div className="ic solid" style={{ width: 40, height: 40, borderRadius: 11, fontSize: 15, fontWeight: 700, background: 'linear-gradient(180deg,#7C5CF0,#5B2BD9)' }}>{c.handle[0].toUpperCase()}</div>
      <div className="fill">
        <Link to={`/reels/${c.handle}`} className="t" style={{ color: 'inherit' }}>{c.handle}</Link>
        <div className="s">{(c.reels_total || 0).toLocaleString()} reels · {c.downloaded ?? c.analysed} downloaded · {c.analysed} analysed{c.top_views ? ` · top reel ${fmt.n(c.top_views)}` : ''}{c.median_like_rate != null ? ` · median like-rate ${c.median_like_rate.toFixed(2)}%` : ''}</div>
        {(c.waiting || (c.failed || 0) > 0) && <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
          {c.waiting && <span className="caption" style={{ color: 'var(--c-amber)' }}>{c.waiting}</span>}
          {(c.failed || 0) > 0 && <button className="linkbtn" style={{ color: 'var(--c-red)' }} onClick={() => setFailOpen(true)}>{c.failed} failed · review</button>}
        </div>}
        {failOpen && <FailuresSheet handle={c.handle} active={active} onClose={() => { setFailOpen(false); onChange() }} onRun={onRun} />}
      </div>
      <div className="slot" style={{ width: 200 }}>{(showSpec || !c.speciality) && (typing
        ? <div className="field" style={{ height: 28, width: 200 }}>
            <SpecInput value={draft} onChange={setDraft} options={specialities} placeholder="Type a speciality" autoFocus
              onEnter={() => save(draft)} onEscape={() => setTyping(false)} onBlur={() => save(draft)} />
          </div>
        : <select className={'chipsel' + (c.speciality ? '' : ' empty')} value={c.speciality || ''} title="Speciality" aria-label={`Speciality of ${c.handle}`}
            onChange={e => { if (e.target.value === '__new') { setDraft(''); setTyping(true) } else save(e.target.value) }}>
            <option value="">Set speciality…</option>
            {specialities.map(x => <option key={x} value={x}>{x}</option>)}
            <option value="__new">Type a new one…</option>
          </select>)}</div>
      <div className="slot" style={{ width: 92 }}>{status}</div>
      <div className="caption slot" style={{ width: 52, justifyContent: 'flex-end' }}>{c.last_run ? fmt.date(c.last_run) : ''}</div>
      <div className="slot" style={{ width: 250, justifyContent: 'flex-end', gap: 6 }}>
        {!active && !viewOnly && (c.reels_total || 0) > 0 && <MoreMenu c={c} busy={busy} onRun={onRun} onStart={async n => { setBusy(true); try { const r = await api.more(c.handle, n); onRun(r.run_id) } catch (e: any) { alert(e.message) } finally { setBusy(false) } }} />}
        {!active && !viewOnly && <button className="btn plain sm" disabled={busy} onClick={run} title={c.status === 'not_run' ? 'Scrape, download and analyse' : 'Run again; a scrape under a day old and files on disk are reused'}>{c.status === 'not_run' ? 'Run' : 'Re-run'}</button>}
        {active && c.run_id && <Link to={`/run/${c.run_id}`} className="btn plain sm">View run</Link>}
        {!active && <HoldButton className="btn plain sm" label="Delete" holdLabel="Hold…" ms={4000} onHold={async () => { await api.deleteClinic(c.handle, true); onChange() }} />}
      </div>
      <Link to={`/reels/${c.handle}`} aria-label="Open">{I.fwd({ className: 'chev' })}</Link>
    </div>
  )
}

/** Text field with the known specialities as suggestions; anything typed is accepted too. */
function SpecInput({ value, onChange, options, placeholder, autoFocus, onEnter, onEscape, onBlur }: { value: string; onChange: (v: string) => void; options: string[]; placeholder: string; autoFocus?: boolean; onEnter?: () => void; onEscape?: () => void; onBlur?: () => void }) {
  return (
    <>
      <input list="reely-specs" value={value} placeholder={placeholder} autoFocus={autoFocus} aria-label="Speciality" maxLength={60}
        onChange={e => onChange(e.target.value)} onBlur={onBlur}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.() } if (e.key === 'Escape') onEscape?.() }} />
      <datalist id="reely-specs">{options.map(o => <option key={o} value={o} />)}</datalist>
    </>
  )
}

/** "More" on a scraped clinic: process the next reels by views without re-scraping or re-downloading. */
function MoreMenu({ c, busy, onStart, onRun }: { c: Clinic; busy: boolean; onStart: (count: number | null) => void; onRun: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [open])
  const left = c.remaining || 0
  const go = (n: number | null) => { setOpen(false); setCustom(''); onStart(n) }
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className={'btn plain sm' + (open ? ' on' : '')} disabled={busy} onClick={() => setOpen(v => !v)} title={`${left.toLocaleString()} scraped reels are not downloaded yet`}>More {I.down({ width: 10, height: 10 })}</button>
      {open && (
        <div className="card menu" style={{ width: 230 }}>
          {left > 0 && <>
          <div className="caption" style={{ padding: '6px 8px 4px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', fontSize: 10.5 }}>Download and analyse more</div>
          {[50, 100, 200].filter(n => n < left).map(n => <button key={n} className="row" onClick={() => go(n)}><span>Next {n}</span><span className="caption">by views</span></button>)}
          <button className="row" onClick={() => go(null)}><span>All remaining</span><span className="caption">{left.toLocaleString()}</span></button>
          <div style={{ borderTop: '1px solid var(--c-hair)', margin: '4px 0 2px' }} />
          <form className="row" style={{ gap: 6 }} onSubmit={e => { e.preventDefault(); const n = parseInt(custom, 10); if (n > 0) go(Math.min(n, left)) }}>
            <span className="caption">Next</span>
            <input type="number" min={1} max={left} value={custom} onChange={e => setCustom(e.target.value)} placeholder="number" aria-label="How many more reels" style={{ flex: 1, minWidth: 0, border: 0, background: 'var(--c-fill)', borderRadius: 6, padding: '4px 8px', font: 'inherit', fontSize: 12, color: 'inherit' }} />
            <button className="btn sm" type="submit" disabled={!(parseInt(custom, 10) > 0)} style={{ height: 24, padding: '0 8px' }}>Go</button>
          </form>
          <div className="caption" style={{ padding: '4px 8px 6px', lineHeight: 1.4 }}>Keeps the scrape and everything already downloaded, transcribed and annotated.</div>
          <div style={{ borderTop: '1px solid var(--c-hair)', margin: '4px 0 2px' }} />
          </>}
          {(c.failed || 0) > 0 && <button className="row" onClick={async () => { setOpen(false); try { const r = await api.retry(c.handle); onRun(r.run_id) } catch (e: any) { alert(e.message) } }}><span>Retry failed</span><span className="caption">{c.failed}</span></button>}
          <button className="row" onClick={async () => { setOpen(false); try { const r = await api.refreshStats(c.handle); onRun(r.run_id) } catch (e: any) { alert(e.message) } }} title="Re-scrape view counts and re-fetch likes; no videos are downloaded"><span>Refresh stats</span><span className="caption">views + likes</span></button>
        </div>
      )}
    </div>
  )
}

const LANE_LABEL: Record<string, string> = { instagram: 'Instagram', gpu: 'Speech engine', claude: 'Claude' }

/** Live view of the run queue: what each lane is doing and who is waiting, with reorder and stop. */
function QueuePanel() {
  const [q, setQ] = useState<{ items: any[]; lanes: Record<string, { holder: string | null; waiting: number }> } | null>(null)
  const load = () => api.queue().then(setQ).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t) }, [])
  if (!q || q.items.length === 0) return null
  return (
    <div>
      <div className="sechead"><span>Queue · {q.items.length} clinic{q.items.length === 1 ? '' : 's'}</span>
        <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, display: 'flex', gap: 14 }}>
          {Object.entries(q.lanes).map(([k, v]) => <span key={k}><span className={'dot ' + (v.holder ? '' : 'off')} style={{ display: 'inline-block', marginRight: 6 }} />{LANE_LABEL[k]}: {v.holder || 'idle'}</span>)}
        </span>
      </div>
      <div className="group">
        {q.items.map((it, i) => (
          <div key={it.run_id} className="grow" style={{ padding: '10px 16px' }}>
            <div className="ic" style={{ width: 28, height: 28, flexBasis: 28 }}><span className="caption" style={{ fontWeight: 700, color: 'var(--c-ink)' }}>{i + 1}</span></div>
            <div className="fill">
              <div style={{ fontSize: 13, fontWeight: 600 }}>{it.clinic} <span className="caption" style={{ fontWeight: 500 }}>· {it.waiting ? 'waiting' : it.stage ? it.stage : it.status}{it.lane && !it.waiting ? ` on ${LANE_LABEL[it.lane]}` : ''}</span></div>
              <div className="caption" style={it.waiting ? { color: 'var(--c-amber)' } : undefined}>{it.waiting || (it.total ? `${it.done ?? 0} of ${it.total} · ${it.note || ''}` : it.note || 'Starting…')}</div>
            </div>
            <button className="iconbtn" aria-label="Move up" disabled={i === 0} onClick={() => api.moveRun(it.run_id, -1).then(load)}>{I.up()}</button>
            <button className="iconbtn" aria-label="Move down" disabled={i === q.items.length - 1} onClick={() => api.moveRun(it.run_id, 1).then(load)}>{I.down()}</button>
            <Link to={`/run/${it.run_id}`} className="btn plain sm">Open</Link>
            <HoldButton className="btn plain sm" label={it.status === 'queued' ? 'Remove' : 'Stop'} holdLabel="Hold…" ms={1500} onHold={() => api.runAction(it.run_id, 'stop').then(load)} />
          </div>
        ))}
      </div>
      <div className="caption" style={{ padding: '6px 4px 0' }}>Clinics overlap: while one transcribes, the next downloads. Each lane serves one clinic at a time, so Instagram never sees more traffic than a single run. Order decides who gets a free lane first.</div>
    </div>
  )
}

/** Disk use per clinic with clean-up actions; nothing is removed without a hold. */
function StoragePanel({ clinics, onChange }: { clinics: string[]; onChange: () => void }) {
  const [d, setD] = useState<{ clinics: any[]; auto_clear_videos: boolean } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const load = () => api.storage().then(setD).catch(() => {})
  useEffect(() => { load() }, [clinics.join(',')])
  if (!d) return null
  const rows = d.clinics.filter(c => clinics.includes(c.handle))
  const total = rows.reduce((a, c) => a + c.videos_bytes, 0)
  const act = async (h: string, what: 'processed' | 'videos' | 'temp') => {
    try { const r = await api.clearData(h, what); setMsg(`${h}: removed ${r.removed} file${r.removed === 1 ? '' : 's'}, freed ${fmt.bytes(r.bytes)}`); load(); onChange() }
    catch (e: any) { setMsg(e.message) }
  }
  return (
    <div>
      <div className="sechead"><span>Storage · videos use {fmt.bytes(total)}</span>
        <label style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          Auto clean-up after each run
          <button className={'toggle' + (d.auto_clear_videos ? ' on' : '')} aria-label="Automatically remove videos once transcribed and annotated"
            onClick={() => api.putSettings({ auto_clear_videos: d.auto_clear_videos ? '0' : '1' }).then(load)} />
        </label>
      </div>
      <div className="group">
        {rows.length === 0 && <div className="grow"><div className="fill sub">No clinic folders yet</div></div>}
        {rows.map(c => (
          <div key={c.handle} className="grow" style={{ padding: '10px 16px' }}>
            <div className="fill">
              <div style={{ fontSize: 13, fontWeight: 600 }}>{c.handle}</div>
              <div className="caption">{c.videos_n} videos · {fmt.bytes(c.videos_bytes)} · {c.processed_n} already transcribed and annotated ({fmt.bytes(c.processed_bytes)}) · transcripts {fmt.bytes(c.transcripts_bytes)}{c.temp_n ? ` · ${c.temp_n} leftover partial files` : ''}</div>
            </div>
            {c.temp_n > 0 && <button className="btn plain sm" onClick={() => act(c.handle, 'temp')}>Clear partial files</button>}
            {c.processed_n > 0 && <HoldButton className="btn plain sm" label={`Clear processed videos · ${fmt.bytes(c.processed_bytes)}`} holdLabel="Hold…" ms={2000} onHold={() => act(c.handle, 'processed')} />}
            {c.videos_n > c.processed_n && <HoldButton className="btn plain sm" label="Clear all videos" holdLabel="Hold…" ms={3000} onHold={() => act(c.handle, 'videos')} />}
          </div>
        ))}
      </div>
      <div className="caption" style={{ padding: '6px 4px 0' }}>{msg || 'Clearing keeps everything learned from a video: likes, captions, transcripts and annotations. Any single video can be downloaded again from its reel card. Videos that are not transcribed yet are only removed by "Clear all videos".'}</div>
    </div>
  )
}

/** Reels a stage could not process, with the reason, and actions to retry or dismiss them. */
function FailuresSheet({ handle, active, onClose, onRun }: { handle: string; active: boolean; onClose: () => void; onRun: (id: number) => void }) {
  const [rows, setRows] = useState<any[] | null>(null)
  const load = () => api.failures(handle).then(setRows).catch(() => setRows([]))
  useEffect(() => { load() }, [handle])
  const open = (rows || []).filter(r => !r.ignored)
  const groups = open.reduce((a: Record<string, number>, r) => ({ ...a, [r.reason]: (a[r.reason] || 0) + 1 }), {})
  return (
    <Sheet title={`Failed reels · ${handle}`} onClose={onClose}>
      <div className="caption" style={{ lineHeight: 1.5 }}>{open.length ? Object.entries(groups).map(([k, v]) => `${v} × ${k}`).join(' · ') : 'Nothing failed.'} Retry runs the clinic again with the existing scrape; every stage skips what is already done.</div>
      <div className="group" style={{ boxShadow: 'none', background: 'var(--c-bg)', maxHeight: 340, overflow: 'auto' }}>
        {(rows || []).map(r => (
          <div key={r.shortcode} className="grow" style={{ padding: '9px 14px', opacity: r.ignored ? .5 : 1 }}>
            <div className="fill">
              <div style={{ fontSize: 13, fontWeight: 600 }}>{r.reason} <span className="caption" style={{ fontWeight: 500 }}>· {r.stage}{r.tries > 1 ? ` · tried ${r.tries}×` : ''}{r.views ? ` · ${fmt.n(r.views)} views` : ''}</span></div>
              <div className="caption" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 380 }} title={r.error}>{r.error}</div>
            </div>
            <a href={r.url} target="_blank" rel="noreferrer" className="caption" style={{ color: 'var(--c-tint)' }}>Instagram {I.ext()}</a>
            <button className="btn plain sm" onClick={() => api.ignoreFailures(handle, [r.shortcode], !r.ignored).then(load)}>{r.ignored ? 'Restore' : 'Dismiss'}</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="caption">Dismissed reels are skipped by future runs.</span>
        <span className="spacer" />
        <button className="btn plain" onClick={onClose}>Close</button>
        <button className="btn" disabled={active || open.length === 0} onClick={async () => { try { const r = await api.retry(handle); onClose(); onRun(r.run_id) } catch (e: any) { alert(e.message) } }}>Retry {open.length} failed</button>
      </div>
    </Sheet>
  )
}
