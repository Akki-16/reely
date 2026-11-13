import { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { HoldButton, SpecialityPicker, Toolbar, Ui, useName } from '../App'
import { api, fmt, lrColor } from '../api'
import type { Clinic } from '../api'
import { I } from '../icons'
import { ExportSheet, ImportSheet, Sheet } from './Transfer'

/** A sheet opened for one account, from its row menu or its panel. */
type Dialog = { kind: 'spec' | 'export' | 'delete' | 'failures'; handle: string } | null
const isActive = (c: Clinic) => ['running', 'queued', 'paused'].includes(c.status)
const videosRunning = (c: Clinic) => c.video_job?.status === 'running'

export default function Clinics({ onRun }: { onRun: (runId: number) => void }) {
  const nameOf = useName()
  const { viewOnly, spec, specialities, refreshClinics, sideOpen } = useContext(Ui)
  const [data, setData] = useState<any>(null)
  const [handle, setHandle] = useState('')
  const [newSpec, setNewSpec] = useState(spec)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'export' | 'import' | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [panel, setPanel] = useState<'open' | 'closing' | null>(null)   // the account panel on the right edge
  const closePanel = () => { setPanel('closing'); setTimeout(() => setPanel(p => p === 'closing' ? null : p), 230) }

  const load = () => api.overview().then(d => { setData(d); refreshClinics() }).catch(e => setErr(e.message))
  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id) }, [])
  useEffect(() => { setNewSpec(spec) }, [spec])

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
  const clinics = all.filter(c => !spec || c.speciality === spec)
  const t = data?.totals
  const s = data?.settings || {}
  const sum = (k: 'reels_total' | 'analysed') => clinics.reduce((a, c) => a + ((c as any)[k] || 0), 0)
  const selC = clinics.find(c => c.handle === sel) || null
  const dc = dialog ? all.find(c => c.handle === dialog.handle) || null : null
  useEffect(() => { if (panel && !selC) setPanel(null) }, [panel, selC])   // its account was deleted or filtered away

  return (
    <>
      <Toolbar title="Overview">
        <SpecialityPicker />
        <button className="btn plain" onClick={() => setSheet('import')} title="Bring in reference accounts exported from another Mac">{I.download()} Import</button>
        <button className="btn plain" onClick={() => setSheet('export')} title="Pack reference accounts into one file for another Mac" disabled={!data?.clinics?.length}>{I.upload()} Export</button>
      </Toolbar>
      {sheet === 'export' && <ExportSheet onClose={() => setSheet(null)} />}
      {sheet === 'import' && <ImportSheet onClose={() => setSheet(null)} onDone={load} />}
      {dialog?.kind === 'export' && <ExportSheet accounts={[dialog.handle]} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'spec' && dc && <SpecSheet c={dc} options={specialities} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog?.kind === 'delete' && dc && <DeleteSheet c={dc} onClose={() => setDialog(null)} onExport={() => setDialog({ kind: 'export', handle: dc.handle })} onDeleted={() => { setDialog(null); setPanel(null); load() }} />}
      {dialog?.kind === 'failures' && dc && <FailuresSheet handle={dc.handle} active={isActive(dc)} onClose={() => { setDialog(null); load() }} onRun={onRun} />}
      {panel && selC && <AccountPanel list={clinics} c={selC} setSel={setSel} closing={panel === 'closing'} onClose={closePanel} withSide={sideOpen} onChange={load} onRun={onRun} setDialog={setDialog} />}
      <div className="main"><div className="main-inner">
        {err && <div className="err">{err}</div>}

        {viewOnly ? (
          <div className="notebox" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <div className="ic tint" style={{ width: 32, height: 32 }}>{I.info({ width: 15, height: 15 })}</div>
            <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}><b>This Mac is view-only.</b> Browse, edit, export and import reference accounts here, and download the videos of imported reels from an account's ··· menu. To add accounts or analyse more reels, run Reely on an Apple Silicon Mac, export, and import the file here.</div>
            <button className="btn plain" onClick={() => setSheet('import')}>{I.download()} Import</button>
          </div>
        ) : (
        <div className="card pad" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '14px 16px' }}>
          <div className="ic tint" style={{ width: 34, height: 34, borderRadius: 10, fontSize: 20, flexBasis: 34 }}>+</div>
          <div className="field" style={{ flex: 1, minWidth: 220, height: 34 }}>
            {I.search()}
            <input placeholder="Handles or profile URLs · paste several to queue them" value={handle} onChange={e => setHandle(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          </div>
          <div className="field" style={{ height: 34, width: 220 }}>
            <SpecInput value={newSpec} onChange={setNewSpec} options={specialities} placeholder="Speciality · pick or type" onEnter={add} />
          </div>
          <button className="btn" onClick={add} disabled={busy || !handles.length}>{busy ? 'Starting…' : handles.length > 1 ? `Queue ${handles.length} accounts` : 'Add & Run'}</button>
        </div>
        )}

        <QueuePanel />

        <div className="grid3">
          <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b className="sub" style={{ color: 'var(--c-ink)' }}>Reels indexed</b><div className="ic tint" style={{ width: 30, height: 30 }}>{I.reels({ width: 15, height: 15 })}</div></div>
            <div className="big">{t ? sum('reels_total').toLocaleString() : '—'}</div>
            <div className="caption">Across {clinics.length} account{clinics.length === 1 ? '' : 's'}{spec ? ` · ${spec}` : ''}</div>
          </div>
          <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b className="sub" style={{ color: 'var(--c-ink)' }}>Analysed</b><div className="ic green" style={{ width: 30, height: 30 }}>{I.check({ width: 15, height: 15 })}</div></div>
            <div className="big">{t ? sum('analysed').toLocaleString() : '—'}</div>
            <div className="caption">Downloaded, transcribed and annotated</div>
          </div>
          <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--c-tint)', color: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', height: 30 }}><b style={{ fontSize: 13 }}>Disk free</b></div>
            <div className="big">{t ? fmt.bytes(t.free_bytes) : '—'}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.8)' }} title="Videos, transcripts, notes and client files, for every speciality. Speech models are listed in Settings.">{t ? <>Reely is using <b style={{ color: '#fff' }}>{fmt.bytes(t.used_bytes ?? t.video_bytes)}</b></> : ' '}</div>
          </div>
        </div>

        <div className="acctable">
          <div className="acchead"><span /><span>Account</span><span>Analysed</span><span>Like-rate</span><span>Last run</span><span /></div>
          {clinics.map(c => <AccountRow key={c.handle} c={c} on={!!panel && sel === c.handle} onOpen={() => { setSel(c.handle); setPanel('open') }} onChange={load} onRun={onRun} setDialog={setDialog} />)}
          {data && clinics.length === 0 && <div className="emptyrow" style={{ padding: '22px 18px' }}>{all.length ? `No reference accounts in ${spec} yet.` : 'No reference accounts yet.'}{viewOnly ? ' Import a file exported from another Mac.' : ' Paste an Instagram handle above and press Add & Run.'}</div>}
        </div>

        <StoragePanel clinics={clinics.map(c => c.handle)} onChange={load} />

        <div className="grid2">
          <div>
            <div className="sechead">Recent runs<Link to="/run" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>All runs</Link></div>
            <div className="group">
              {(data?.recent_runs || []).length === 0 && <div className="grow"><div className="fill sub">No runs yet</div></div>}
              {(data?.recent_runs || []).map((r: any) => (
                <Link key={r.id} to={`/run/${r.id}`} className="grow click" style={{ color: 'inherit', padding: '11px 16px' }}>
                  <div className="fill" style={{ fontSize: 13 }}>{nameOf(r.clinic)} <span className="caption">· {r.status}{r.stage ? ` · ${r.stage}` : ''}</span></div>
                  <div className="caption">{fmt.date(r.started)} {fmt.time(r.started)}</div>
                  {I.fwd({ className: 'chev', width: 12, height: 12 })}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <div className="sechead">Defaults for new runs<Link to="/settings" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>Change</Link></div>
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

/** Everything that can be started on one account. Runs open the run page; errors show as a toast. */
function useAccount(c: Clinic, onRun: (id: number) => void, onChange: () => void) {
  const nameOf = useName()
  const { toast, ask, refreshClinics } = useContext(Ui)
  const [busy, setBusy] = useState(false)
  const start = async (f: () => Promise<{ run_id: number }>) => {
    if (busy) return
    setBusy(true)
    try { const r = await f(); onRun(r.run_id) } catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }
  return {
    busy,
    update: () => start(() => api.startRun(c.handle)),
    more: (n: number | null) => start(() => api.more(c.handle, n)),
    refresh: () => start(() => api.refreshStats(c.handle)),
    recheck: () => start(() => api.recheck(c.handle)),
    retry: () => start(() => api.retry(c.handle)),
    videos: async (n: number | null) => { try { await api.clinicVideos(c.handle, n); onChange() } catch (e: any) { toast(e.message) } },
    rename: async () => {
      const n = await ask({ title: 'Rename this account', label: `Name for @${c.handle}`, value: nameOf(c.handle) === c.handle ? '' : nameOf(c.handle), placeholder: c.handle, optional: true, ok: 'Save',
        note: 'Shown everywhere in Reely in place of the Instagram handle. Leave it empty to go back to the handle. Files, exports and links keep using the handle.' })
      if (n === null) return
      try { await api.editClinic(c.handle, { display_name: n }); refreshClinics(); onChange() } catch (e: any) { toast(e.message) }
    },
  }
}

/** How many transcripts of an account end well before their video does; asked only while a menu or panel shows it. */
function useShort(handle: string, on: boolean) {
  const [short, setShort] = useState<{ count: number; with_video: number } | null>(null)
  useEffect(() => { setShort(null); if (on) api.recheckCount(handle).then(setShort).catch(() => {}) }, [handle, on])
  return short
}

/** 50 · 100 · 200 · All · other…: how many of the remaining items to take. */
function CountChips({ steps, left, onPick }: { steps: number[]; left: number; onPick: (n: number | null) => void }) {
  const [other, setOther] = useState(false)
  const [v, setV] = useState('')
  const n = parseInt(v, 10)
  if (other) return (
    <form className="countchips" onSubmit={e => { e.preventDefault(); if (n > 0) onPick(Math.min(n, left)) }}>
      <input type="number" min={1} max={left} autoFocus value={v} onChange={e => setV(e.target.value)} placeholder="How many" aria-label="How many"
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOther(false) } }} />
      <button className="btn sm" type="submit" disabled={!(n > 0)}>Go</button>
      <button className="cchip" type="button" onClick={() => setOther(false)}>Cancel</button>
    </form>
  )
  return (
    <div className="countchips">
      {steps.filter(x => x < left).map(x => <button key={x} className="cchip" onClick={() => onPick(x)}>{x}</button>)}
      <button className="cchip all" onClick={() => onPick(null)}>All {left.toLocaleString()}</button>
      <button className="cchip other" onClick={() => setOther(true)}>other…</button>
    </div>
  )
}

function AccountRow({ c, on, onOpen, onChange, onRun, setDialog }: { c: Clinic; on: boolean; onOpen: () => void; onChange: () => void; onRun: (id: number) => void; setDialog: (d: Dialog) => void }) {
  const nameOf = useName()
  const { viewOnly } = useContext(Ui)
  const act = useAccount(c, onRun, onChange)
  const name = nameOf(c.handle)
  const total = c.reels_total || 0
  const quiet = (e: React.MouseEvent) => e.stopPropagation()   // controls inside the row do not open the panel
  const status = () => {
    if (videosRunning(c)) return <><span className="pill tint" title={c.video_job!.note}>Videos {c.video_job!.done}/{c.video_job!.total ?? '…'}</span><button className="btn plain sm" onClick={() => api.clinicVideosStop(c.handle).then(onChange)}>Stop</button></>
    if (isActive(c)) return <>
      {c.status === 'queued' ? <span className="pill grey" title={c.waiting || 'Queued'}><span className="dot off" />Queued</span>
        : c.status === 'paused' ? <span className="pill amber">Paused</span>
        : <span className="pill amber" title={c.waiting || ''}><span className="dot warn" />{c.waiting ? 'Waiting' : 'Running'}</span>}
      {c.run_id && <Link to={`/run/${c.run_id}`} className="btn plain sm">View run</Link>}
    </>
    if (c.status === 'not_run' && !viewOnly) return <button className="btn sm" disabled={act.busy} onClick={act.update} title="Scrape, download and analyse">Run</button>
    const [dot, word] = c.status === 'done' ? ['', c.last_run || !c.imported ? 'Done' : 'Imported'] : c.status === 'failed' ? ['bad', 'Failed'] : c.status === 'stopped' ? ['off', 'Stopped'] : ['off', 'Not run']
    const when = c.last_run || (c.status === 'done' ? c.imported?.at : null)
    return <><span className={'dot ' + dot} />{word}{when ? ` · ${fmt.date(when)}` : ''}</>
  }
  return (
    <div className={'accrow' + (on ? ' on' : '')} role="button" tabIndex={0} aria-label={`Open ${name}`} onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen() }}>
      <div className="ic solid" style={{ width: 38, height: 38, flexBasis: 38, borderRadius: 11, fontSize: 15, fontWeight: 700, background: 'linear-gradient(180deg,#7C5CF0,#5B2BD9)' }}>{(name[0] || '?').toUpperCase()}</div>
      <div style={{ minWidth: 0 }}>
        <div className="accname">{name}</div>
        <div className="accsub">{total.toLocaleString()} reels{c.top_views ? ` · top reel ${fmt.n(c.top_views)}` : ''}{!c.speciality && <> · <button className="linkbtn" style={{ fontSize: 12.5 }} onClick={e => { quiet(e); setDialog({ kind: 'spec', handle: c.handle }) }}>Set speciality</button></>}</div>
        {(c.waiting || (c.failed || 0) > 0) && <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' }}>
          {c.waiting && <span className="caption" style={{ color: 'var(--c-amber)' }}>{c.waiting}</span>}
          {(c.failed || 0) > 0 && <button className="linkbtn" style={{ color: 'var(--c-red)' }} onClick={e => { quiet(e); setDialog({ kind: 'failures', handle: c.handle }) }}>{c.failed} failed · review</button>}
        </div>}
      </div>
      <div>
        {total > 0 ? <>
          <div style={{ fontSize: 12.5 }}><b>{(c.analysed || 0).toLocaleString()}</b> <span style={{ color: 'var(--c-sub)' }}>of {total.toLocaleString()} analysed</span></div>
          <div className="accbar"><span style={{ width: `${Math.min(100, Math.round((c.analysed || 0) / total * 100))}%` }} /></div>
        </> : <span className="caption">Nothing scraped yet</span>}
      </div>
      <div>{c.median_like_rate != null ? <><b style={{ color: lrColor(c.median_like_rate), fontSize: 14.5 }}>{c.median_like_rate.toFixed(2)}%</b><div className="caption" style={{ fontSize: 11.5 }}>median like-rate</div></> : <span className="caption">—</span>}</div>
      <div className="accstatus" onClick={isActive(c) || videosRunning(c) || c.status === 'not_run' ? quiet : undefined}>{status()}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }} onClick={quiet}><AccountMenu c={c} act={act} setDialog={setDialog} /></div>
    </div>
  )
}

/** The ··· menu on a row: every action for the account, without leaving the list. */
function AccountMenu({ c, act, setDialog }: { c: Clinic; act: ReturnType<typeof useAccount>; setDialog: (d: Dialog) => void }) {
  const { viewOnly } = useContext(Ui)
  const [open, setOpen] = useState(false)
  const short = useShort(c.handle, open && !viewOnly)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])
  const active = isActive(c), vids = videosRunning(c)
  const canRun = !viewOnly && !active
  const left = canRun && !vids ? c.remaining || 0 : 0
  const missing = !active && !vids ? c.missing_videos || 0 : 0
  const item = (label: string, meta: string, f: () => void, title?: string) => (
    <button className="row" title={title} onClick={() => { setOpen(false); f() }}><span>{label}</span>{meta && <span className="caption">{meta}</span>}</button>
  )
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className={'iconbtn accdots' + (open ? ' on' : '')} aria-label={`Actions for ${c.handle}`} aria-expanded={open} disabled={act.busy} onClick={() => setOpen(v => !v)}>···</button>
      {open && (
        <div className="card menu accmenu">
          {left > 0 && <>
            <div className="menuhead">Analyse more reels · {left.toLocaleString()} left</div>
            <div style={{ padding: '3px 8px 8px' }} title="Next by views. Keeps the scrape and everything already downloaded, transcribed and annotated."><CountChips steps={[50, 100, 200]} left={left} onPick={n => { setOpen(false); act.more(n) }} /></div>
            <div className="menurule" />
          </>}
          {(canRun || missing > 0) && <>
            <div className="menuhead">Keep it current</div>
            {canRun && item(c.status === 'not_run' ? 'Run' : 'Update', 'new reels + numbers', act.update, 'Scrape, download and analyse again. A scrape under a day old and files on disk are reused.')}
            {canRun && (c.reels_total || 0) > 0 && item('Refresh views and likes', '', act.refresh, 'Re-scrape view counts and re-fetch likes. No videos are downloaded.')}
            {canRun && short && short.with_video > 0 && item('Re-check transcripts', `${short.with_video} stop early`, act.recheck, 'Listens again to reels whose transcript ends well before the video does. Where more speech is found, the transcript is replaced and the reel is annotated again. Reels you edited keep your labels.')}
            {missing > 0 && item('Download missing videos', missing.toLocaleString(), () => act.videos(null), 'For analysed reels with no video here, such as an import without videos. Transcripts and notes stay as they are.')}
            {canRun && (c.pending || 0) > 0 && item('Download remaining', String(c.pending), act.retry, 'Reels a download stage left for later because Instagram was limiting this network')}
            {canRun && (c.failed || 0) > 0 && item('Retry failed', String(c.failed), act.retry)}
            <div className="menurule" />
          </>}
          <div className="menuhead">Account</div>
          {active && c.run_id && <Link className="row" to={`/run/${c.run_id}`}><span>View run</span></Link>}
          {item('Rename…', '', act.rename)}
          {item('Change speciality…', c.speciality ? '' : 'not set', () => setDialog({ kind: 'spec', handle: c.handle }))}
          {item('Export…', '', () => setDialog({ kind: 'export', handle: c.handle }))}
          {!active && <>
            <div className="menurule" />
            <button className="row danger" onClick={() => { setOpen(false); setDialog({ kind: 'delete', handle: c.handle }) }}><span>Delete account…</span></button>
          </>}
        </div>
      )}
    </div>
  )
}

/** The account panel: slides in from the right edge over a dimmed page, like the reel panel. ← → step through the
 *  accounts, Esc, the scrim or ✕ close it. Rendered on document.body because .main-inner animates. */
function AccountPanel({ list, c, setSel, closing, onClose, withSide, onChange, onRun, setDialog }: { list: Clinic[]; c: Clinic; setSel: (h: string) => void; closing: boolean; onClose: () => void; withSide: boolean; onChange: () => void; onRun: (id: number) => void; setDialog: (d: Dialog) => void }) {
  const nameOf = useName()
  const i = list.findIndex(x => x.handle === c.handle)
  const go = (d: number) => { const n = list[i + d]; if (n) setSel(n.handle) }
  const goRef = useRef(go); goRef.current = go
  const closeRef = useRef(onClose); closeRef.current = onClose
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return
      if (document.querySelector('.sheet-back')) return          // a sheet on top handles its own keys
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current() }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goRef.current(1) }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goRef.current(-1) }
    }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, [])
  return createPortal(
    <>
      <div className={'reelscrim' + (withSide ? ' withside' : '') + (closing ? ' out' : '')} onMouseDown={onClose} aria-hidden />
      <div className={'reelpanel accpanel' + (closing ? ' out' : '')} role="dialog" aria-label={`Account ${nameOf(c.handle)}`}>
        <div className="accpanel-body">
          <div className="reelpanel-head" data-tauri-drag-region>
            <button className="iconbtn" aria-label="Previous account" disabled={i <= 0} onClick={() => go(-1)}>{I.back({ width: 13, height: 13 })}</button>
            <button className="iconbtn" aria-label="Next account" disabled={i < 0 || i >= list.length - 1} onClick={() => go(1)}>{I.fwd({ width: 13, height: 13 })}</button>
            <span className="caption" style={{ color: 'var(--c-sub)', fontSize: 12.5 }}>{i + 1} of {list.length}</span>
            <span className="spacer" data-tauri-drag-region />
            <span className="caption hint">← → to move · Esc to close</span>
            <button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button>
          </div>
          <AccountDetail key={c.handle} c={c} onChange={onChange} onRun={onRun} setDialog={setDialog} />
        </div>
      </div>
    </>, document.body)
}

function AccountDetail({ c, onChange, onRun, setDialog }: { c: Clinic; onChange: () => void; onRun: (id: number) => void; setDialog: (d: Dialog) => void }) {
  const nameOf = useName()
  const { viewOnly } = useContext(Ui)
  const act = useAccount(c, onRun, onChange)
  const short = useShort(c.handle, !viewOnly)
  const name = nameOf(c.handle)
  const active = isActive(c), vids = videosRunning(c)
  const canRun = !viewOnly && !active && !vids
  const total = c.reels_total || 0
  const left = canRun ? c.remaining || 0 : 0
  const missing = !active && !vids ? c.missing_videos || 0 : 0
  const fresh = c.status === 'not_run'
  const row = (t: string, s: string, meta: string, f: () => void, primary = false) => (
    <div className="actrow" key={t}>
      <div className="fill"><b>{t}</b><div className="s">{s}</div></div>
      {meta && <span className="caption" style={{ whiteSpace: 'nowrap' }}>{meta}</span>}
      <button className={'btn sm' + (primary ? '' : ' plain')} disabled={act.busy} onClick={f}>Start</button>
    </div>
  )
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 20 }}>
        <div className="ic solid" style={{ width: 52, height: 52, flexBasis: 52, borderRadius: 15, fontSize: 21, fontWeight: 700, background: 'linear-gradient(180deg,#7C5CF0,#5B2BD9)' }}>{(name[0] || '?').toUpperCase()}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="accpanel-name"><span>{name}</span><button className="linkbtn" style={{ fontSize: 12 }} onClick={act.rename}>Rename</button></div>
          <div className="sub" style={{ marginTop: 2 }}>@{c.handle}{c.speciality ? ` · ${c.speciality}` : ''} · <a href={`https://www.instagram.com/${c.handle}/`} target="_blank" rel="noreferrer">Instagram {I.ext()}</a></div>
        </div>
      </div>
      <div className="acctiles">
        <div><b>{total.toLocaleString()}</b><span>reels</span></div>
        <div><b>{(c.analysed || 0).toLocaleString()}</b><span>analysed</span></div>
        <div><b style={c.median_like_rate != null ? { color: lrColor(c.median_like_rate) } : undefined}>{c.median_like_rate != null ? c.median_like_rate.toFixed(2) + '%' : '—'}</b><span>like-rate</span></div>
        <div><b>{c.top_views ? fmt.n(c.top_views) : '—'}</b><span>top reel</span></div>
      </div>
      {total > 0 && <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}><span><b>{(c.analysed || 0).toLocaleString()}</b> of {total.toLocaleString()} reels analysed</span>{!viewOnly && (c.remaining || 0) > 0 && <span className="caption" title="Scraped reels that are not downloaded yet">{(c.remaining || 0).toLocaleString()} left</span>}</div>
        <div className="accbar big"><span style={{ width: `${Math.min(100, Math.round((c.analysed || 0) / total * 100))}%` }} /></div>
      </div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className="btn" to={`/reels/${c.handle}`}>Open reels</Link>
        <Link className="btn plain" to={`/insights/${c.handle}`}>Insights</Link>
        <Link className="btn plain" to={`/categories?account=${encodeURIComponent(c.handle)}`}>Categories</Link>
      </div>
      {active && <div className="notebox" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45 }}><b>{c.status === 'queued' ? 'Waiting in the queue' : c.status === 'paused' ? 'Run paused' : 'A run is in progress'}</b>{c.waiting ? <div className="caption" style={{ color: 'var(--c-amber)' }}>{c.waiting}</div> : <div className="caption">New actions can start when it finishes.</div>}</div>
        {c.run_id && <Link to={`/run/${c.run_id}`} className="btn plain sm">View run</Link>}
      </div>}
      {vids && <div className="notebox" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45 }}><b>Downloading videos · {c.video_job!.done} of {c.video_job!.total ?? '…'}</b><div className="caption">{c.video_job!.note}</div></div>
        <button className="btn plain sm" onClick={() => api.clinicVideosStop(c.handle).then(onChange)}>Stop</button>
      </div>}
      {c.video_job && !vids && <div className="caption" style={{ marginTop: -6 }}>Last video download: {c.video_job.status === 'error' ? 'stopped with an error · ' : ''}{c.video_job.note}</div>}
      {(c.failed || 0) > 0 && <div className="notebox" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, fontSize: 13 }}><b style={{ color: 'var(--c-red)' }}>{c.failed} reel{c.failed === 1 ? '' : 's'} failed</b><div className="caption">See why, then retry or dismiss them.</div></div>
        <button className="btn plain sm" onClick={() => setDialog({ kind: 'failures', handle: c.handle })}>Review</button>
      </div>}
      {(canRun || missing > 0) && <div>
        <div className="sechead">Do more with this account</div>
        <div className="actlist">
          {canRun && row(fresh ? 'Run' : 'Update', fresh ? 'Scrape, download and analyse the top reels' : 'Get new reels and fresh numbers', c.last_run ? `last run ${fmt.date(c.last_run)}` : '', act.update, true)}
          {left > 0 && <div className="actrow">
            <div className="fill"><b>Analyse more reels</b><div className="s">Next by views · keeps what is done</div></div>
            <CountChips steps={[50, 100, 200]} left={left} onPick={act.more} />
          </div>}
          {canRun && total > 0 && row('Refresh views and likes', 'No videos, no transcription', '', act.refresh)}
          {canRun && short && short.with_video > 0 && row('Re-check transcripts', 'Listen again where the text stops early', `${short.with_video} stop early`, act.recheck)}
          {missing > 25 ? <div className="actrow">
            <div className="fill"><b>Download missing videos</b><div className="s">Best like-rate first · {missing.toLocaleString()} missing</div></div>
            <CountChips steps={[25, 50, 100]} left={missing} onPick={act.videos} />
          </div> : missing > 0 && row('Download missing videos', 'For analysed reels with no video here', `${missing} missing`, () => act.videos(null))}
          {canRun && (c.pending || 0) > 0 && row('Download remaining', 'Reels left for later while Instagram was limiting this network', String(c.pending), act.retry)}
        </div>
      </div>}
      <div>
        <div className="sechead">Account</div>
        <div className="accstrip">
          <button onClick={() => setDialog({ kind: 'spec', handle: c.handle })}>Speciality…</button>
          <button onClick={() => setDialog({ kind: 'export', handle: c.handle })}>Export…</button>
          <Link to={`/run?account=${encodeURIComponent(c.handle)}`}>Run history</Link>
          <button className="danger" disabled={active} title={active ? 'Stop the run first' : undefined} onClick={() => setDialog({ kind: 'delete', handle: c.handle })}>Delete…</button>
        </div>
      </div>
      {c.imported && <div className="caption">Imported from {c.imported.from} on {fmt.date(c.imported.at)}{c.imported.videos ? '' : ', without videos'}.</div>}
    </>
  )
}

function SpecSheet({ c, options, onClose, onSaved }: { c: Clinic; options: string[]; onClose: () => void; onSaved: () => void }) {
  const nameOf = useName()
  const { toast, refreshClinics } = useContext(Ui)
  const [v, setV] = useState(c.speciality || '')
  const save = async () => {
    try { await api.editClinic(c.handle, { speciality: v.trim() || null }); refreshClinics(); onSaved(); onClose() } catch (e: any) { toast(e.message) }
  }
  return (
    <Sheet title={`Speciality of ${nameOf(c.handle)}`} onClose={onClose}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{options.map(o => <button key={o} className={'chipbtn' + (v === o ? ' on' : '')} onClick={() => setV(o)}>{o}</button>)}</div>
      <label className="formrow"><span>Or type a new one</span>
        <div className="field"><input value={v} maxLength={60} placeholder="Speciality" aria-label="Speciality" onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }} /></div>
      </label>
      <div className="caption" style={{ lineHeight: 1.5 }}>Accounts are grouped and compared within their speciality. Leave it empty to clear.</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn plain" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save} disabled={(v.trim() || null) === (c.speciality || null)}>Save</button>
      </div>
    </Sheet>
  )
}

function DeleteSheet({ c, onClose, onDeleted, onExport }: { c: Clinic; onClose: () => void; onDeleted: () => void; onExport: () => void }) {
  const nameOf = useName()
  const { toast, refreshClinics } = useContext(Ui)
  return (
    <Sheet title={`Delete ${nameOf(c.handle)}?`} onClose={onClose}>
      <div className="sub" style={{ lineHeight: 1.55, color: 'var(--c-ink)' }}>This removes <b>@{c.handle}</b> from Reely: its {(c.reels_total || 0).toLocaleString()} scraped reels, {(c.analysed || 0).toLocaleString()} transcripts and notes, its run history and chat, and its whole folder of videos on this Mac.</div>
      <div className="caption" style={{ lineHeight: 1.5 }}>This cannot be undone. Export the account first if you might want it back.</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn plain" onClick={onExport}>Export first…</button>
        <span className="spacer" />
        <button className="btn plain" onClick={onClose}>Cancel</button>
        <HoldButton className="btn danger" label="Hold to delete" holdLabel="Keep holding…" ms={2000} danger={false}
          onHold={async () => { try { await api.deleteClinic(c.handle, true); refreshClinics(); onDeleted() } catch (e: any) { toast(e.message) } }} />
      </div>
    </Sheet>
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

const LANE_LABEL: Record<string, string> = { instagram: 'Instagram', gpu: 'Speech engine', claude: 'Claude' }

/** Live view of the run queue: what each lane is doing and who is waiting, with reorder and stop. */
function QueuePanel() {
  const nameOf = useName()
  const [q, setQ] = useState<{ items: any[]; lanes: Record<string, { holder: string | null; waiting: number }> } | null>(null)
  const load = () => api.queue().then(setQ).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t) }, [])
  if (!q || q.items.length === 0) return null
  return (
    <div>
      <div className="sechead"><span>Queue · {q.items.length} account{q.items.length === 1 ? '' : 's'}</span>
        <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, display: 'flex', gap: 14 }}>
          {Object.entries(q.lanes).map(([k, v]) => <span key={k}><span className={'dot ' + (v.holder ? '' : 'off')} style={{ display: 'inline-block', marginRight: 6 }} />{LANE_LABEL[k]}: {v.holder || 'idle'}</span>)}
        </span>
      </div>
      <div className="group">
        {q.items.map((it, i) => (
          <div key={it.run_id} className="grow" style={{ padding: '10px 16px' }}>
            <div className="ic" style={{ width: 28, height: 28, flexBasis: 28 }}><span className="caption" style={{ fontWeight: 700, color: 'var(--c-ink)' }}>{i + 1}</span></div>
            <div className="fill">
              <div style={{ fontSize: 13, fontWeight: 600 }}>{nameOf(it.clinic)} <span className="caption" style={{ fontWeight: 500 }}>· {it.waiting ? 'waiting' : it.stage ? it.stage : it.status}{it.lane && !it.waiting ? ` on ${LANE_LABEL[it.lane]}` : ''}</span></div>
              <div className="caption" style={it.waiting ? { color: 'var(--c-amber)' } : undefined}>{it.waiting || (it.total ? `${it.done ?? 0} of ${it.total} · ${it.note || ''}` : it.note || 'Starting…')}</div>
            </div>
            <button className="iconbtn" aria-label="Move up" disabled={i === 0} onClick={() => api.moveRun(it.run_id, -1).then(load)}>{I.up()}</button>
            <button className="iconbtn" aria-label="Move down" disabled={i === q.items.length - 1} onClick={() => api.moveRun(it.run_id, 1).then(load)}>{I.down()}</button>
            <Link to={`/run/${it.run_id}`} className="btn plain sm">Open</Link>
            <HoldButton className="btn plain sm" label={it.status === 'queued' ? 'Remove' : 'Stop'} holdLabel="Hold…" ms={1500} onHold={() => api.runAction(it.run_id, 'stop').then(load)} />
          </div>
        ))}
      </div>
      <div className="caption" style={{ padding: '6px 4px 0' }}>Accounts overlap: while one transcribes, the next downloads. Each lane serves one account at a time, so Instagram never sees more traffic than a single run. Order decides who gets a free lane first.</div>
    </div>
  )
}

/** Disk use per clinic with clean-up actions; nothing is removed without a hold. */
function StoragePanel({ clinics, onChange }: { clinics: string[]; onChange: () => void }) {
  const nameOf = useName()
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
        {rows.length === 0 && <div className="grow"><div className="fill sub">No account folders yet</div></div>}
        {rows.map(c => (
          <div key={c.handle} className="grow" style={{ padding: '10px 16px' }}>
            <div className="fill">
              <div style={{ fontSize: 13, fontWeight: 600 }}>{nameOf(c.handle)}</div>
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
      <div className="caption" style={{ lineHeight: 1.5 }}>{open.length ? Object.entries(groups).map(([k, v]) => `${v} × ${k}`).join(' · ') : 'Nothing failed.'} Retry runs the account again with the existing scrape; every stage skips what is already done.</div>
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
