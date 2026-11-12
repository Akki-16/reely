import { useContext, useEffect, useMemo, useState } from 'react'
import { Ui } from '../App'
import { api, fmt, isTauri } from '../api'
import { I } from '../icons'

type Est = Record<string, { core: number; videos: number; videos_n: number; transcripts: number; transcripts_n: number; insights: number; chat: number; chat_n: number }>
type Job = { status: string; kind?: string; done?: number; total?: number | null; note?: string; error?: string; result?: any }

const PARTS: { key: 'transcripts' | 'insights' | 'chat' | 'videos'; label: string; desc: string }[] = [
  { key: 'transcripts', label: 'Transcripts', desc: 'Spoken text, timestamps and translations' },
  { key: 'insights', label: 'Insights write-up', desc: 'INSIGHTS.md for each account' },
  { key: 'chat', label: 'Ask Claude threads', desc: 'Questions and answers kept per account' },
  { key: 'videos', label: 'Videos', desc: 'The downloaded reels; by far the largest part' },
]

function useJob(active: boolean, onFinish: (j: Job) => void) {
  const [job, setJob] = useState<Job | null>(null)
  useEffect(() => {
    if (!active) return
    const t = setInterval(async () => {
      const j = await api.transferJob().catch(() => null)
      if (!j) return
      setJob(j)
      if (j.status !== 'running') { clearInterval(t); onFinish(j) }
    }, 600)
    return () => clearInterval(t)
  }, [active])
  return [job, setJob] as const
}

export function Sheet({ title, onClose, children, busy }: { title: string; onClose: () => void; children: React.ReactNode; busy?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, [busy])
  return (
    <div className="sheet-back" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="card sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <b style={{ fontSize: 17, letterSpacing: '-.015em' }}>{title}</b>
          <span className="spacer" />
          <button className="iconbtn" aria-label="Close" onClick={onClose} disabled={busy}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Progress({ job }: { job: Job | null }) {
  const pct = job?.total ? Math.round(((job.done || 0) / job.total) * 100) : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className={'bar live' + (pct == null ? ' indeterminate' : '')} style={{ height: 6 }}><div style={pct != null ? { width: pct + '%' } : undefined} /></div>
      <span className="caption">{job?.note || 'Starting…'}</span>
    </div>
  )
}

export function ExportSheet({ onClose }: { onClose: () => void }) {
  const { clinics, spec } = useContext(Ui)
  const scoped = clinics.filter(c => !spec || c.speciality === spec)
  const [sel, setSel] = useState<string[]>(() => scoped.map(c => c.handle))
  const [inc, setInc] = useState<Record<string, boolean>>({ transcripts: true, insights: true, chat: true, videos: false })
  const [est, setEst] = useState<Est>({})
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<any>(null)
  const [job] = useJob(running, j => { setRunning(false); if (j.status === 'done') setDone(j.result); else setErr(j.error || 'Export failed') })

  useEffect(() => { const all = clinics.map(c => c.handle); if (all.length) api.transferEstimate(all).then(setEst).catch(() => {}) }, [clinics.length])
  const sum = (k: keyof Est[string]) => sel.reduce((a, h) => a + ((est[h]?.[k] as number) || 0), 0)
  const total = sum('core') + PARTS.reduce((a, p) => a + (inc[p.key] ? sum(p.key) : 0), 0)
  const toggle = (h: string) => setSel(s => s.includes(h) ? s.filter(x => x !== h) : [...s, h])
  const start = async () => { setErr(null); try { await api.transferExport(sel, inc); setRunning(true) } catch (e: any) { setErr(e.message) } }

  return (
    <Sheet title="Export reference accounts" onClose={onClose} busy={running}>
      <div className="caption" style={{ lineHeight: 1.5 }}>Packs the chosen reference accounts into one <span className="mono">.reely</span> file in Downloads. Import it in Reely on another Mac to get the same reels, analysis and insights without scraping or downloading again.</div>
      {done ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="notebox" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <div className="ic green" style={{ width: 32, height: 32 }}>{I.check({ width: 15, height: 15 })}</div>
            <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 13 }}>Exported {done.clinics.length} account{done.clinics.length === 1 ? '' : 's'} · {fmt.bytes(done.bytes)}</b><div className="caption" style={{ wordBreak: 'break-all' }}>{done.path.replace(/^\/Users\/[^/]+/, '~')}</div></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Done</button></div>
        </div>
      ) : <>
        <div>
          <div className="sechead" style={{ padding: '0 2px 6px' }}><span>Accounts · {sel.length} of {clinics.length}</span>
            <button className="linkbtn" onClick={() => setSel(sel.length === clinics.length ? [] : clinics.map(c => c.handle))}>{sel.length === clinics.length ? 'Select none' : 'Select all'}</button></div>
          <div className="group checklist" style={{ boxShadow: 'none', background: 'var(--c-bg)', maxHeight: 210, overflow: 'auto' }}>
            {clinics.map(c => (
              <label key={c.handle} className="grow" style={{ padding: '9px 14px', cursor: 'pointer' }}>
                <input type="checkbox" checked={sel.includes(c.handle)} onChange={() => toggle(c.handle)} disabled={running} />
                <div className="fill"><div style={{ fontSize: 13, fontWeight: 600 }}>{c.handle}</div><div className="caption">{c.speciality || 'No speciality'} · {(c.reels_total || 0).toLocaleString()} reels · {c.analysed} analysed</div></div>
                <span className="caption">{est[c.handle] ? fmt.bytes(est[c.handle].core + PARTS.reduce((a, p) => a + (inc[p.key] ? est[c.handle][p.key] : 0), 0)) : ''}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="sechead" style={{ padding: '0 2px 6px' }}>What to include</div>
          <div className="group" style={{ boxShadow: 'none', background: 'var(--c-bg)' }}>
            <label className="grow" style={{ padding: '9px 14px' }}>
              <input type="checkbox" checked disabled />
              <div className="fill"><div style={{ fontSize: 13, fontWeight: 600 }}>Reel data and analysis</div><div className="caption">Views, likes, captions, hooks, formats, notes and your edits · always included</div></div>
              <span className="caption">{fmt.bytes(sum('core'))}</span>
            </label>
            {PARTS.map(p => (
              <label key={p.key} className="grow" style={{ padding: '9px 14px', cursor: 'pointer' }}>
                <input type="checkbox" checked={inc[p.key]} onChange={() => setInc(x => ({ ...x, [p.key]: !x[p.key] }))} disabled={running} />
                <div className="fill"><div style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</div><div className="caption">{p.desc}{p.key === 'videos' && sum('videos_n') ? ` · ${sum('videos_n').toLocaleString()} files` : ''}</div></div>
                <span className="caption">{fmt.bytes(sum(p.key))}</span>
              </label>
            ))}
          </div>
        </div>
        {err && <div className="err">{err}</div>}
        {running ? <Progress job={job} /> : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="caption">About {fmt.bytes(total)}</span>
            <span className="spacer" />
            <button className="btn plain" onClick={onClose}>Cancel</button>
            <button className="btn" onClick={start} disabled={!sel.length}>Export {sel.length} account{sel.length === 1 ? '' : 's'}</button>
          </div>
        )}
      </>}
    </Sheet>
  )
}

export function ImportSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [info, setInfo] = useState<any>(null)
  const [sel, setSel] = useState<string[]>([])
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<any>(null)
  const [job] = useJob(running, j => { setRunning(false); if (j.status === 'done') { setDone(j.result); onDone() } else setErr(j.error || 'Import failed') })
  const conflicts = useMemo(() => (info?.clinics || []).filter((c: any) => sel.includes(c.handle) && c.exists), [info, sel])

  const choose = async () => {
    setErr(null)
    let path: string | null = null
    if (isTauri) {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const r = await open({ multiple: false, directory: false, title: 'Choose a Reely export', filters: [{ name: 'Reely export', extensions: ['reely', 'zip'] }] })
      path = typeof r === 'string' ? r : null
    } else path = window.prompt('Path to the .reely file')
    if (!path) return
    try { const i = await api.transferInspect(path); setInfo(i); setSel(i.clinics.map((c: any) => c.handle)) } catch (e: any) { setErr(e.message); setInfo(null) }
  }
  const start = async () => { setErr(null); try { await api.transferImport(info.path, sel, mode); setRunning(true) } catch (e: any) { setErr(e.message) } }
  const partChips = (inc: any) => [['Reel data', true], ['Transcripts', inc?.transcripts], ['Insights', inc?.insights], ['Ask threads', inc?.chat], ['Videos', inc?.videos]] as [string, boolean][]

  return (
    <Sheet title="Import reference accounts" onClose={onClose} busy={running}>
      {done ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {done.clinics.map((c: any) => (
            <div key={c.handle} className="notebox" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <div className={'ic ' + (c.skipped ? '' : 'green')} style={{ width: 30, height: 30 }}>{c.skipped ? '!' : I.check({ width: 14, height: 14 })}</div>
              <div style={{ flex: 1 }}><b style={{ fontSize: 13 }}>{c.handle}</b><div className="caption">{c.skipped ? `Skipped · ${c.skipped}` : `${c.added} files added${c.kept ? ` · ${c.kept} already here, kept` : ''}`}</div></div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Done</button></div>
        </div>
      ) : !info ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
          <div className="caption" style={{ lineHeight: 1.5 }}>Choose a <span className="mono">.reely</span> file exported from Reely on this or another Mac. You will see what is inside before anything is changed.</div>
          {err && <div className="err" style={{ alignSelf: 'stretch' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-end' }}><button className="btn plain" onClick={onClose}>Cancel</button><button className="btn" onClick={choose}>Choose file…</button></div>
        </div>
      ) : <>
        <div className="caption">{info.path.split('/').pop()} · exported {fmt.date(info.created)} · {fmt.bytes(info.bytes)} <button className="linkbtn" style={{ marginLeft: 6 }} onClick={choose} disabled={running}>Choose another</button></div>
        <div className="group" style={{ boxShadow: 'none', background: 'var(--c-bg)', maxHeight: 260, overflow: 'auto' }}>
          {info.clinics.map((c: any) => (
            <label key={c.handle} className="grow" style={{ padding: '10px 14px', cursor: 'pointer', alignItems: 'flex-start' }}>
              <input type="checkbox" checked={sel.includes(c.handle)} onChange={() => setSel(s => s.includes(c.handle) ? s.filter(x => x !== c.handle) : [...s, c.handle])} disabled={running} style={{ marginTop: 3 }} />
              <div className="fill" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{c.handle} {c.exists && <span className="pill amber" style={{ padding: '1px 7px', fontSize: 10.5, marginLeft: 4 }}>Already on this Mac</span>}</div>
                <div className="caption">{c.speciality || 'No speciality'} · {(c.reels_total || 0).toLocaleString()} reels · {c.analysed ?? 0} analysed</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{partChips(c.included).map(([n, on]) => <span key={n} className={'chip'} style={on ? undefined : { opacity: .45, textDecoration: 'line-through' }}>{n}</span>)}</div>
              </div>
            </label>
          ))}
        </div>
        {conflicts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="seg" style={{ alignSelf: 'flex-start' }}>
              <button className={mode === 'merge' ? 'on' : ''} onClick={() => setMode('merge')} disabled={running}>Merge</button>
              <button className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')} disabled={running}>Replace</button>
            </div>
            <div className="caption" style={{ lineHeight: 1.5 }}>{mode === 'merge'
              ? `${conflicts.length} account${conflicts.length === 1 ? ' is' : 's are'} already here. Merge keeps everything on this Mac and only adds what is missing; your edits win over the file's.`
              : `Replace deletes ${conflicts.map((c: any) => c.handle).join(', ')} on this Mac, including videos and threads, and uses the file's copy instead.`}</div>
          </div>
        )}
        {err && <div className="err">{err}</div>}
        {running ? <Progress job={job} /> : (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn plain" onClick={onClose}>Cancel</button>
            <button className={'btn' + (mode === 'replace' && conflicts.length ? ' danger' : '')} onClick={start} disabled={!sel.length}>Import {sel.length} account{sel.length === 1 ? '' : 's'}</button>
          </div>
        )}
      </>}
    </Sheet>
  )
}
