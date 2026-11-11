import { useContext, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ClinicPicker, HoldButton, SpecialityPicker, Toolbar, Ui } from '../App'
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

export default function Run() {
  const { id } = useParams()
  const { spec, clinics } = useContext(Ui)
  const [run, setRun] = useState<RunT | null>(null)
  const [runs, setRuns] = useState<RunT[]>([])
  const [clinic, setClinic] = useState('_all')
  const [err, setErr] = useState<string | null>(null)
  const [skipping, setSkipping] = useState(false)
  const [stopping, setStopping] = useState(false)
  const runningStage = run?.stages ? Object.keys(run.stages).find(k => run.stages[k]?.status === 'running') : undefined
  useEffect(() => { setSkipping(false) }, [runningStage])
  useEffect(() => { setStopping(false) }, [run?.id, run?.status])

  useEffect(() => {
    let alive = true
    const inScope = (r: RunT) => (clinic === '_all' || r.clinic === clinic) && (!spec || clinics.find(c => c.handle === r.clinic)?.speciality === spec)
    const load = async () => {
      try {
        if (id) { const r = await api.run(Number(id)); if (alive) setRun(r) }
        else {
          const rs = (await api.runs()).filter(inScope)
          if (alive) { setRuns(rs); setRun(rs[0] ? await api.run(rs[0].id) : null) }
        }
      } catch (e: any) { if (alive) setErr(e.message) }
    }
    load()
    const t = setInterval(load, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [id, clinic, spec, clinics])

  const pickers = !id && <><SpecialityPicker /><ClinicPicker value={clinic} onChange={setClinic} /></>

  if (!run) return <><Toolbar title="Run">{pickers}</Toolbar><div className="main"><div className="main-inner"><h1 className="large">Run</h1><div className="lead">{err || (clinic !== '_all' || spec ? 'No runs for this selection yet.' : 'No runs yet. Add a clinic to start one.')}</div></div></div></>

  const st = run.stages || {}
  const order = STAGES.map(s => s[0])
  const doneN = order.filter(k => ['done', 'skipped'].includes(st[k]?.status)).length
  const running = order.find(k => st[k]?.status === 'running')
  const waitingNote = Object.values(st).find((v: any) => v?.status === 'waiting') as any
  const headline = run.status === 'queued' ? 'Queued.' : waitingNote && run.status === 'running' ? 'Waiting…' : run.status === 'done' ? 'Finished.' : run.status === 'failed' ? 'Failed.' : run.status === 'stopped' ? 'Stopped.' : run.status === 'paused' ? 'Paused.'
    : running === 'scrape' ? 'Scraping…' : running === 'download' ? 'Downloading…' : running === 'transcribe' ? 'Transcribing…' : running === 'translate' ? 'Translating…' : running === 'annotate' ? 'Annotating with Claude…' : running === 'insights' ? 'Writing insights…' : 'Starting…'
  const cur = running ? st[running] : null
  const lead = waitingNote ? `@${run.clinic} · ${waitingNote.note}` : run.status === 'done' ? `All six stages complete for @${run.clinic}. Open Reels to study the results.`
    : run.error ? run.error
    : cur?.total ? `@${run.clinic} · ${cur.done ?? 0} of ${cur.total} · ${cur.note || ''}` : cur?.note ? `@${run.clinic} · ${cur.note}` : `Run ${run.id} for @${run.clinic}`
  const active = run.status === 'running' || run.status === 'paused' || run.status === 'queued'

  return (
    <>
      <Toolbar title={`Run · ${run.clinic}`}>
        {pickers}
        {active && <span className="pill amber"><span className="dot warn" />{run.status === 'paused' ? 'Paused' : 'Running'}</span>}
        {run.status === 'done' && <span className="pill green"><span className="dot" />Done</span>}
        {run.status === 'failed' && <span className="pill red"><span className="dot bad" />Failed</span>}
        {active && (run.status === 'paused'
          ? <button className="btn plain" onClick={() => api.runAction(run.id, 'resume')}>Resume</button>
          : <button className="btn plain" onClick={() => api.runAction(run.id, 'pause')}>Pause</button>)}
        {active && running && ['scrape', 'download', 'transcribe', 'translate'].includes(running) && !skipping && (
          <button className="btn plain" title="Finish the current item, then move straight to the next stage" onClick={() => { setSkipping(true); api.runAction(run.id, 'skip') }}>Skip to {NEXT[running]} →</button>)}
        {active && skipping && <span className="pill tint"><span className="dot" style={{ background: 'var(--c-tint)' }} />Finishing current item…</span>}
        {active && <HoldButton label="Hold to stop" holdLabel="Hold…" onHold={() => { setStopping(true); api.runAction(run.id, 'stop') }} />}
        {active && stopping && <span className="caption">Stop requested · finishing the current item</span>}
        {!active && <Link to={`/reels/${run.clinic}`} className="btn">Open Reels</Link>}
      </Toolbar>
      <div className="main"><div className="main-inner">
        <div>
          <h1 className="large">{headline}</h1>
          <div className="lead">{lead}</div>
        </div>

        <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><b style={{ fontSize: 15 }}>Overall progress</b><span className="caption">Stage {Math.min(doneN + 1, 6)} of 6 · started {fmt.date(run.started)} {fmt.time(run.started)}</span></div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--c-fill)', overflow: 'hidden', display: 'flex' }}>
            <div style={{ width: `${(doneN / 6) * 100}%`, background: 'var(--c-ink)' }} />
            {cur && <div style={{ width: `${(1 / 6) * 100 * (cur.total ? (cur.done || 0) / cur.total : 0.3)}%`, background: 'var(--c-tint)' }} />}
          </div>
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
                {[['Analyse', `Top ${run.settings?.top_n} by views`], ['Whisper', `${run.settings?.whisper_model}${run.settings?.whisper_engine === 'whisper.cpp' ? ' · Metal' : ''}`], ['Quality', run.settings?.video_quality === 'low' ? '360p · low' : 'Best'], ['Translate', run.settings?.translate === '1' ? `To ${langName(run.settings?.translate_to || 'en')}` : 'Off'], ['Annotation', run.settings?.annotation_mode]].map(([k, v]) => (
                  <div key={k} className="grow" style={{ padding: '11px 16px' }}><div className="fill" style={{ fontSize: 13 }}>{k}</div><div className="sub">{v}</div></div>
                ))}
              </div>
              {active && <div className="caption" style={{ padding: '8px 4px 0' }}>Settings are locked while a stage is running.</div>}
            </div>
            <div>
              <div className="sechead">Log <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>newest first</span></div>
              <div className="group" style={{ padding: '12px 16px', fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.8, color: 'var(--c-sub)', maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                {(run.log || '').trim().split('\n').slice(-60).reverse().join('\n') || 'Waiting for output…'}
              </div>
            </div>
            {!id && runs.length > 1 && (
              <div>
                <div className="sechead">Earlier runs</div>
                <div className="group">{runs.slice(1, 6).map(r => <Link key={r.id} to={`/run/${r.id}`} className="grow click" style={{ color: 'inherit', padding: '10px 16px' }}><div className="fill" style={{ fontSize: 13 }}>{r.clinic} <span className="caption">· {r.status}</span></div><div className="caption">{fmt.date(r.started)}</div></Link>)}</div>
              </div>
            )}
          </div>
        </div>
      </div></div>
    </>
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
        {(active || done) && s.extra && typeof s.extra === 'object' && !Array.isArray(s.extra) && Object.keys(s.extra).length > 0 && Object.entries(s.extra).every(([k, v]) => /^[a-z]{2,3}$/.test(k) && k !== 'ok' && typeof v === 'number') && (
          <div className="caption" style={{ marginTop: 6 }}>{Object.entries(s.extra as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>
        )}
      </div>
      <div className="caption" style={{ color: active ? 'var(--c-tint)' : undefined, fontWeight: active ? 600 : 500, whiteSpace: 'nowrap' }}>
        {active && s.total ? `${s.done ?? 0} / ${s.total}` : active && s.done != null ? `${s.done}` : active ? 'Running' : done && s.seconds != null ? `${Math.round(s.seconds / 60) || '<1'} min` : waiting ? 'Waiting' : skipped ? 'Skipped' : failed ? 'Failed' : done ? 'Done' : 'Queued'}
      </div>
    </div>
  )
}
