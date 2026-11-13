import { useContext, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ClinicPicker, HoldButton, SpecialityPicker, Toolbar, Ui, useName } from '../App'
import { api, fmt, langName } from '../api'
import type { Run as RunT, Stage } from '../api'
import { I } from '../icons'

const fmtSpeed = (bps: number) => bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} MB/s` : `${Math.round(bps / 1e3)} KB/s`
const NEXT: Record<string, string> = { scrape: 'download', download: 'transcribe', transcribe: 'translate', translate: 'annotate' }
const STAGES: [string, string, string][] = [
  ['scrape', 'Scrape Reels grid', 'Opens the saved browser session and reads every tile\'s play count'],
  ['download', 'Download top reels', 'yt-dlp, 360p, named by view count'],
  ['transcribe', 'Transcribe', 'Whisper on this Mac'],
  ['translate', 'Translate to English', 'Non-English reels only'],
  ['annotate', 'Annotate with Claude', 'Hook, type, format, CTA, flag, summary'],
  ['insights', 'Write insights', 'INSIGHTS.md from the merged sheet'],
]
const STAGE_VERB: Record<string, string> = { scrape: 'Scraping', download: 'Downloading', transcribe: 'Transcribing', translate: 'Translating', annotate: 'Annotating', insights: 'Writing insights' }
const ACTIVE = ['queued', 'running', 'paused']
const isActive = (r: { status: string }) => ACTIVE.includes(r.status)

const when = (d: string | null | undefined) => d ? new Date(d.replace(' ', 'T')) : null
function dur(sec: number | null | undefined) {
  if (sec == null || isNaN(sec)) return '—'
  if (sec < 60) return '<1 min'
  const m = Math.round(sec / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

/** Counts a finished (or stopped) run produced, read from its stage notes and extras. */
function summarize(r: RunT) {
  const st = r.stages || {}
  const num = (s: string | undefined, re: RegExp) => { const m = (s || '').match(re); return m ? Number(m[1]) : null }
  const dx: any = st.download?.extra
  const hasDx = dx && typeof dx === 'object' && 'ok' in dx
  return {
    scraped: st.scrape?.status === 'skipped' ? null : num(st.scrape?.note, /(\d+) reels/),
    scrapeReused: st.scrape?.status === 'skipped',
    downloaded: hasDx ? (dx.ok || 0) + (dx.skipped || 0) : st.download?.done ?? num(st.download?.note, /(\d+) new/),
    dlFailed: hasDx ? dx.failed || 0 : num(st.download?.note, /(\d+) failed/),
    speed: hasDx || (dx && typeof dx.speed_bps === 'number') ? dx.speed_bps as number | null : null,
    bytes: dx && typeof dx.bytes === 'number' ? dx.bytes as number : null,
    transcribed: num(st.transcribe?.note, /(\d+) transcribed/) ?? (st.transcribe?.status === 'running' ? st.transcribe?.done ?? null : null),
    tErrors: num(st.transcribe?.note, /(\d+) errors/),
    translated: num(st.translate?.note, /(\d+) translated/),
    annotated: num(st.annotate?.note, /(\d+) annotated/),
    stoppedAt: STAGES.map(s => s[0]).find(k => ['running', 'failed', 'waiting'].includes(st[k]?.status || '')) || null,
  }
}

export default function Run() {
  const { id } = useParams()
  const nav = useNavigate()
  const { spec, clinics } = useContext(Ui)
  const [queue, setQueue] = useState<any[]>([])
  const [runs, setRuns] = useState<RunT[]>([])
  const [clinic, setClinic] = useState('_all')
  const [tab, setTab] = useState<number | 'history' | null>(id ? Number(id) : null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const inScope = (c: string) => (clinic === '_all' || c === clinic) && (!spec || clinics.find(x => x.handle === c)?.speciality === spec)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const [q, rs] = await Promise.all([api.queue(), api.runs()])
        if (!alive) return
        setQueue(q.items); setRuns(rs); setErr(null)
      } catch (e: any) { if (alive) setErr(e.message) }
    }
    load(); const t = setInterval(load, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const activeTabs = useMemo(() => queue.filter(q => inScope(q.clinic)), [queue, clinic, spec, clinics])
  const history = useMemo(() => runs.filter(r => !isActive(r) && inScope(r.clinic)), [runs, clinic, spec, clinics])

  // pick a tab: the URL's run if it is live, otherwise its card in History; else the first live run; else History
  useEffect(() => {
    if (!runs.length && !queue.length) return
    if (id) {
      const n = Number(id)
      if (queue.some(q => q.run_id === n)) setTab(n)
      else { setTab('history'); setOpenId(n) }
      return
    }
    setTab(t => (typeof t === 'number' && queue.some(q => q.run_id === t)) || t === 'history' ? t : activeTabs[0]?.run_id ?? 'history')
  }, [id, queue.length, runs.length, activeTabs.map(q => q.run_id).join(',')])
  // a live run that finishes moves to History, opened
  useEffect(() => {
    if (typeof tab === 'number' && runs.length && !queue.some(q => q.run_id === tab)) { setOpenId(tab); setTab(activeTabs[0]?.run_id ?? 'history') }
  }, [queue.map(q => q.run_id).join(',')])

  const pick = (t: number | 'history') => { setTab(t); if (id) nav('/run', { replace: true }) }
  const pickers = <><SpecialityPicker /><ClinicPicker value={clinic} onChange={setClinic} /></>

  return (
    <>
      {typeof tab === 'number' ? <LiveRun key={tab} runId={tab} pickers={pickers} tabs={<Tabs items={activeTabs} tab={tab} onPick={pick} historyCount={history.length} />} />
        : <>
          <Toolbar title="Run">{pickers}</Toolbar>
          <div className="main"><div className="main-inner">
            <Tabs items={activeTabs} tab={tab} onPick={pick} historyCount={history.length} />
            {err && <div className="err">{err}</div>}
            <History runs={history} openId={openId} setOpenId={setOpenId} loading={!runs.length && !err} />
          </div></div>
        </>}
    </>
  )
}

function Tabs({ items, tab, onPick, historyCount }: { items: any[]; tab: number | 'history' | null; onPick: (t: number | 'history') => void; historyCount: number }) {
  const nameOf = useName()
  return (
    <div className="runtabs" role="tablist" aria-label="Runs">
      {items.map((q, i) => {
        const pct = q.total ? Math.min(100, Math.round(((q.done || 0) / q.total) * 100)) : null
        const label = q.status === 'queued' && !q.stage ? 'Queued' : q.status === 'paused' ? 'Paused'
          : q.waiting ? 'Waiting' : q.stage ? `${STAGE_VERB[q.stage] || q.stage}${q.total ? ` · ${q.done ?? 0} / ${q.total}` : ''}` : 'Starting'
        const on = tab === q.run_id
        return (
          <button key={q.run_id} role="tab" aria-selected={on} className={'runtab' + (on ? ' on' : '')} onClick={() => onPick(q.run_id)} title={q.waiting || q.note || ''}>
            <span className="rt-name"><span className="rt-no">{i + 1}</span>{nameOf(q.clinic)}</span>
            <span className={'rt-sub' + (q.waiting || q.status === 'queued' ? ' muted' : '')}>{label}</span>
            <span className="rt-bar">{pct != null && <span style={{ width: pct + '%' }} />}</span>
          </button>
        )
      })}
      {items.length === 0 && <span className="caption" style={{ padding: '0 4px 12px' }}>No runs in progress</span>}
      <span className="spacer" />
      <button role="tab" aria-selected={tab === 'history'} className={'runtab hist' + (tab === 'history' ? ' on' : '')} onClick={() => onPick('history')}>
        <span className="rt-name">{I.history()} History · {historyCount}</span>
      </button>
    </div>
  )
}

function LiveRun({ runId, pickers, tabs }: { runId: number; pickers: React.ReactNode; tabs: React.ReactNode }) {
  const nameOf = useName()
  const [run, setRun] = useState<RunT | null>(null)
  const [skipping, setSkipping] = useState(false)
  const [stopping, setStopping] = useState(false)
  useEffect(() => {
    let alive = true
    const load = () => api.run(runId).then(r => alive && setRun(r)).catch(() => {})
    load(); const t = setInterval(load, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [runId])
  const runningStage = run?.stages ? Object.keys(run.stages).find(k => run.stages[k]?.status === 'running') : undefined
  useEffect(() => { setSkipping(false) }, [runningStage])

  if (!run) return <><Toolbar title="Run">{pickers}</Toolbar><div className="main"><div className="main-inner">{tabs}<div className="empty">Loading…</div></div></div></>

  const st = run.stages || {}
  const order = STAGES.map(s => s[0])
  const doneN = order.filter(k => ['done', 'skipped'].includes(st[k]?.status)).length
  const running = order.find(k => st[k]?.status === 'running')
  const waiting = Object.values(st).find((v: any) => v?.status === 'waiting') as Stage | undefined
  const cur = running ? st[running] : null
  const active = isActive(run)
  const started = when(run.started)
  const sofar = started ? (Date.now() - started.getTime()) / 1000 : null
  const statusChip = run.status === 'paused' ? 'Paused' : run.status === 'queued' && !running ? 'Queued' : waiting ? 'Waiting' : 'Running'

  return (
    <>
      <Toolbar title={`Run · ${nameOf(run.clinic)}`}>
        {pickers}
        {active && (run.status === 'paused'
          ? <button className="btn plain" onClick={() => api.runAction(run.id, 'resume')}>Resume</button>
          : <button className="btn plain" onClick={() => api.runAction(run.id, 'pause')}>Pause</button>)}
        {active && running && ['scrape', 'download', 'transcribe', 'translate'].includes(running) && !skipping && (
          <button className="btn plain" title="Finish the current item, then move straight to the next stage" onClick={() => { setSkipping(true); api.runAction(run.id, 'skip') }}>Skip to {NEXT[running]} →</button>)}
        {active && skipping && <span className="statuschip tint">Finishing current item…</span>}
        {active && !stopping && <HoldButton label="Hold to stop" holdLabel="Hold…" onHold={() => { setStopping(true); api.runAction(run.id, 'stop') }} />}
        {active && stopping && <span className="statuschip">Stopping after this item</span>}
        {active && <span className={'statuschip ' + (statusChip === 'Running' ? 'amber' : statusChip === 'Paused' ? 'grey' : 'tint')}><span className="dot" />{statusChip}</span>}
      </Toolbar>
      <div className="main"><div className="main-inner">
        {tabs}
        <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <b style={{ fontSize: 15 }}>{nameOf(run.clinic)}</b>{nameOf(run.clinic) !== run.clinic && <span className="caption">@{run.clinic}</span>}
            <span className="caption">Stage {Math.min(doneN + 1, 6)} of 6 · started {fmt.date(run.started)} {fmt.time(run.started)}{sofar != null ? ` · ${dur(sofar)} so far` : ''}</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--c-fill)', overflow: 'hidden', display: 'flex' }}>
            <div style={{ width: `${(doneN / 6) * 100}%`, background: 'var(--c-ink)', transition: 'width .8s var(--ease)' }} />
            {cur && <div style={{ width: `${(1 / 6) * 100 * (cur.total ? (cur.done || 0) / cur.total : 0.3)}%`, background: 'var(--c-tint)', transition: 'width .8s var(--ease)' }} />}
          </div>
          {waiting?.note && <div className="caption">{waiting.note}</div>}
          {run.error && <div className="err">{run.error}</div>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
          <div>
            <div className="sechead">Stages</div>
            <div className="group">
              {STAGES.map(([k, name, desc], i) => <StageRow key={k} n={i + 1} name={name} desc={desc} s={st[k] || { status: 'queued' }} active={running === k} />)}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div>
              <div className="sechead">Run settings</div>
              <div className="group">
                {settingsRows(run).map(([k, v]) => (
                  <div key={k} className="grow" style={{ padding: '11px 16px' }}><div className="fill" style={{ fontSize: 13 }}>{k}</div><div className="sub">{v}</div></div>
                ))}
              </div>
              <div className="caption" style={{ padding: '8px 4px 0' }}>Settings are locked while a stage is running.</div>
            </div>
            <div>
              <div className="sechead">Log <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>newest first</span></div>
              <div className="group logbox" style={{ maxHeight: 260 }}>
                {(run.log || '').trim().split('\n').slice(-60).reverse().join('\n') || 'Waiting for output…'}
              </div>
            </div>
          </div>
        </div>
      </div></div>
    </>
  )
}

const settingsRows = (run: RunT): [string, string][] => [
  ['Analyse', `Top ${run.settings?.top_n} by views`],
  ['Whisper', `${run.settings?.whisper_model || '—'}${run.settings?.whisper_engine === 'whisper.cpp' ? ' · Metal' : ''}`],
  ['Quality', run.settings?.video_quality === 'low' ? '360p · low' : 'Best'],
  ['Translate', run.settings?.translate === '1' ? `To ${langName(run.settings?.translate_to || 'en')}` : 'Off'],
  ['Annotation', run.settings?.annotation_mode || '—'],
]

function History({ runs, openId, setOpenId, loading }: { runs: RunT[]; openId: number | null; setOpenId: (n: number | null) => void; loading: boolean }) {
  const [filter, setFilter] = useState<'all' | 'done' | 'stopped' | 'failed'>('all')
  const shown = runs.filter(r => filter === 'all' || r.status === filter)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="seg">{(['all', 'done', 'stopped', 'failed'] as const).map(f => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}</div>
        <span className="caption">{shown.length} run{shown.length === 1 ? '' : 's'}</span>
      </div>
      {loading && <div className="empty">Loading…</div>}
      {!loading && shown.length === 0 && <div className="group"><div className="empty">No finished runs here yet.</div></div>}
      <div className="group" style={{ display: shown.length ? undefined : 'none' }}>
        {shown.map(r => <HistoryRun key={r.id} r={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} />)}
      </div>
    </div>
  )
}

function HistoryRun({ r, open, onToggle }: { r: RunT; open: boolean; onToggle: () => void }) {
  const nameOf = useName()
  const [full, setFull] = useState<RunT | null>(null)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (open && !full) api.run(r.id).then(setFull).catch(() => {}) }, [open])
  const s = summarize(r)
  const a = when(r.started), b = when(r.finished)
  const total = a && b ? (b.getTime() - a.getTime()) / 1000 : null
  const pill = r.status === 'done' ? <span className="pill green"><span className="dot" />Done</span>
    : r.status === 'failed' ? <span className="pill red"><span className="dot bad" />Failed</span>
    : <span className="pill grey">Stopped</span>
  const brief = [s.scraped != null ? `${s.scraped.toLocaleString()} scraped` : s.scrapeReused ? 'scrape reused' : null,
    s.downloaded != null ? `${s.downloaded} downloaded` : null, s.annotated != null ? `${s.annotated} annotated` : null,
    r.status !== 'done' && s.stoppedAt ? `${r.status} during ${s.stoppedAt}` : null].filter(Boolean).join(' · ')
  const secs = STAGES.map(([k]) => r.stages?.[k]?.status === 'skipped' ? 0 : r.stages?.[k]?.seconds ?? 0)
  const maxS = Math.max(1, ...secs)
  const logLines = (full?.log || '').trim().split('\n').filter(Boolean).reverse()
  const shownLog = errorsOnly ? logLines.filter(l => /error|failed/i.test(l)) : logLines
  const cell = (v: number | null, label: React.ReactNode) => <div className="hcell"><div className="hv">{v != null ? v.toLocaleString() : '—'}</div><div className="caption">{label}</div></div>

  return (
    <div className={'hrun' + (open ? ' open' : '')}>
      <button className="hrun-h" onClick={onToggle} aria-expanded={open}>
        {open ? I.down() : I.fwd({ width: 12, height: 12 })}
        <span className="fill" style={{ minWidth: 0 }}>
          <b>{nameOf(r.clinic)}</b> <span className="caption">· run {r.id} · {fmt.date(r.started)} {fmt.time(r.started)}{b ? ` → ${fmt.time(r.finished)}` : ''}</span>
          {!open && brief && <span className="caption" style={{ display: 'block', marginTop: 2 }}>{brief}</span>}
        </span>
        <span className="caption">{dur(total)}</span>
        {pill}
      </button>
      {open && (
        <div className="hrun-b fade">
          <div className="hcells">
            {cell(s.scraped, s.scrapeReused ? 'scrape reused' : 'scraped')}
            {cell(s.downloaded, <>downloaded{s.dlFailed ? <> · <span style={{ color: 'var(--c-red)' }}>{s.dlFailed} failed</span></> : null}</>)}
            {cell(s.transcribed, <>transcribed{s.tErrors ? <> · <span style={{ color: 'var(--c-red)' }}>{s.tErrors} errors</span></> : null}</>)}
            {cell(s.translated, 'translated')}
            {cell(s.annotated, 'annotated')}
            <div className="hcell"><div className="hv">{s.bytes != null ? fmt.bytes(s.bytes) : '—'}</div><div className="caption">downloaded data</div></div>
          </div>
          <div className="hgrid">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div className="sechead" style={{ padding: 0 }}>Time per stage</div>
              {STAGES.map(([k, name], i) => {
                const stg = r.stages?.[k]
                const label = stg?.status === 'skipped' ? 'skipped' : stg?.status === 'queued' || !stg ? '—' : dur(stg.seconds)
                return (
                  <div key={k} className="tbar">
                    <span>{name.replace(' Reels grid', '').replace(' top reels', '').replace(' with Claude', '').replace(' to English', '')}</span>
                    <span className="bar" style={{ height: 8 }}><span style={{ display: 'block', height: '100%', width: `${(secs[i] / maxS) * 100}%`, borderRadius: 4, background: stg?.status === 'failed' ? 'var(--c-red)' : 'var(--c-tint)' }} /></span>
                    <span className="caption" style={{ textAlign: 'right' }}>{label}</span>
                  </div>
                )
              })}
              <div className="caption" style={{ lineHeight: 1.5 }}>
                {full ? settingsRows(full).map(([k, v]) => `${k} ${v}`).join(' · ') : 'Loading settings…'}{s.speed ? ` · ${fmtSpeed(s.speed)} average download` : ''}
              </div>
              {r.error && <div className="err" style={{ fontSize: 12 }}>{r.error}</div>}
              <div style={{ display: 'flex', gap: 8 }}><Link to={`/reels/${r.clinic}`} className="btn plain sm">Open Reels</Link><Link to={`/insights/${r.clinic}`} className="btn plain sm">Insights</Link></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="sechead" style={{ padding: 0, flex: 1 }}>Log · newest first</span>
                <button className={'btn plain sm' + (errorsOnly ? ' on' : '')} onClick={() => setErrorsOnly(v => !v)}>Errors only</button>
                <button className="btn plain sm" onClick={async () => { try { await navigator.clipboard.writeText(shownLog.join('\n')) } catch { } setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
              <div className="logbox inset">{!full ? 'Loading…' : shownLog.length ? shownLog.map((l, i) => <div key={i} className={/error|failed/i.test(l) ? 'bad' : undefined}>{l}</div>) : (errorsOnly ? 'No errors in this run.' : 'No log kept.')}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StageRow({ n, name, desc, s, active }: { n: number; name: string; desc: string; s: Stage; active: boolean }) {
  const done = s.status === 'done', skipped = s.status === 'skipped', failed = s.status === 'failed', waiting = s.status === 'waiting'
  const icon = done ? <div className="ic green">{I.check({ width: 14, height: 14 })}</div>
    : active ? <div className="ic spinner" aria-label="Working"><span /></div>
    : failed ? <div className="ic" style={{ background: 'var(--c-red-soft)', color: 'var(--c-red)' }}>!</div>
    : <div className="ic"><span className="caption" style={{ fontWeight: 600 }}>{n}</span></div>
  const pct = s.total ? Math.round(((s.done || 0) / s.total) * 100) : null
  return (
    <div className={'grow stage' + (active ? ' active' : '') + (done ? ' isdone' : '')}>
      {icon}
      <div className="fill">
        <div className="t" style={{ color: done || active || failed ? 'var(--c-ink)' : 'var(--c-muted)' }}>{name}</div>
        <div className="s" style={{ color: skipped ? 'var(--c-muted)' : undefined }}>{waiting ? s.note : done ? (s.note || desc) : failed ? (s.note || 'failed') : skipped ? `Skipped · ${s.note}` : active ? (s.note || desc) : desc}</div>
        {active && pct != null && <div className="bar live" style={{ marginTop: 8, maxWidth: 360 }}><div style={{ width: pct + '%' }} /></div>}
        {active && pct == null && <div className="bar live indeterminate" style={{ marginTop: 8, maxWidth: 360 }}><div /></div>}
        {(active || done) && s.extra && typeof s.extra === 'object' && typeof (s.extra as any).speed_bps === 'number' && (
          <div className="caption" style={{ marginTop: 6 }}>{fmtSpeed((s.extra as any).speed_bps)} average · {fmt.bytes((s.extra as any).bytes || 0)} downloaded{(s.extra as any).pace ? ` · ${(s.extra as any).pace} pace` : ''}</div>
        )}
        {done && s.extra && typeof s.extra === 'object' && (s.extra as any).blocked === true && (
          <div className="caption" style={{ marginTop: 6, color: 'var(--c-amber)' }}>Instagram limited downloads from this network, so {(s.extra as any).pending} reels were left for later. The run continued with the videos it had. Use More → Download remaining on the clinic in a few hours, or on another network.</div>
        )}
        {(active || done) && s.extra && typeof s.extra === 'object' && !Array.isArray(s.extra) && Object.keys(s.extra).length > 0 && Object.entries(s.extra).every(([k, v]) => /^[a-z]{2,3}$/.test(k) && k !== 'ok' && typeof v === 'number') && (
          <div className="caption" style={{ marginTop: 6 }}>{Object.entries(s.extra as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>
        )}
      </div>
      <div className="caption" style={{ color: active ? 'var(--c-tint)' : undefined, fontWeight: active ? 600 : 500, whiteSpace: 'nowrap' }}>
        {active && s.total ? `${s.done ?? 0} / ${s.total}` : active && s.done != null ? `${s.done}` : active ? 'Running' : done && s.seconds != null ? dur(s.seconds) : waiting ? 'Waiting' : skipped ? 'Skipped' : failed ? 'Failed' : done ? 'Done' : 'Queued'}
      </div>
    </div>
  )
}
