import { useContext, useEffect, useMemo, useState } from 'react'
import { Ui, useName } from '../App'
import { useNavigate } from 'react-router-dom'
import { api, fmt, isTauri } from '../api'
import type { ClientEstimate } from '../api'
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

const cmeta = (c: ClientEstimate) => [c.people ? `${c.people} ${c.people === 1 ? 'person' : 'people'}` : null, c.branches ? `${c.branches} branch${c.branches === 1 ? '' : 'es'}` : null, `${c.sources} sources`, c.has_brief ? 'brief' : null, c.plans ? `${c.plans} plan${c.plans === 1 ? '' : 's'}` : null, `${c.scripts} scripts`].filter(Boolean).join(' · ')

function Row({ checked, onChange, title, sub, size, disabled, radio }: { checked: boolean; onChange?: () => void; title: React.ReactNode; sub?: React.ReactNode; size?: React.ReactNode; disabled?: boolean; radio?: boolean }) {
  return (
    <label className="grow" style={{ padding: '9px 14px', cursor: disabled ? 'default' : 'pointer', alignItems: 'flex-start' }}>
      <input type={radio ? 'radio' : 'checkbox'} checked={checked} onChange={onChange} disabled={disabled} style={{ marginTop: 3 }} />
      <div className="fill"><div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>{sub && <div className="caption" style={{ lineHeight: 1.45 }}>{sub}</div>}</div>
      {size != null && <span className="caption">{size}</span>}
    </label>
  )
}

/** Export reference accounts and clients. With `client`, exports just that client from its room. */
export function ExportSheet({ onClose, client, accounts }: { onClose: () => void; client?: number; accounts?: string[] }) {
  const { clinics, spec, words } = useContext(Ui)
  const scoped = clinics.filter(c => !spec || c.speciality === spec)
  const [sel, setSel] = useState<string[]>(() => client ? [] : accounts || scoped.map(c => c.handle))
  const [cls, setCls] = useState<{ id: number; name: string; color: string | null }[]>([])
  const [csel, setCsel] = useState<number[]>(client ? [client] : [])
  const [cest, setCest] = useState<Record<string, ClientEstimate>>({})
  const [refMode, setRefMode] = useState<'reels' | 'accounts' | 'none'>('reels')
  const [inc, setInc] = useState<Record<string, boolean>>({ transcripts: true, insights: true, chat: true, videos: false, client_files: true, ref_videos: false })
  const [est, setEst] = useState<Est>({})
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<any>(null)
  const [job] = useJob(running, j => { setRunning(false); if (j.status === 'done') setDone(j.result); else setErr(j.error || 'Export failed') })

  useEffect(() => { const all = clinics.map(c => c.handle); if (all.length) api.transferEstimate(all).then(setEst).catch(() => {}) }, [clinics.length])
  useEffect(() => {
    api.clients().then(l => {
      setCls(l.map(c => ({ id: c.id, name: c.name, color: c.color })))
      if (!client && !accounts) setCsel(l.filter(c => !spec || c.speciality === spec).map(c => c.id))
      if (l.length) api.transferEstimateClients(l.map(c => c.id)).then(setCest).catch(() => {})
    }).catch(() => {})
  }, [])

  const one = client != null ? cest[String(client)] : null
  // exporting one client with "their whole accounts" sends those accounts too
  const handles = client != null ? (refMode === 'accounts' ? (one?.ref_accounts || []) : []) : sel
  const sum = (k: keyof Est[string], hs = handles) => hs.reduce((a, h) => a + ((est[h]?.[k] as number) || 0), 0)
  const csum = (k: keyof ClientEstimate) => csel.reduce((a, id) => a + ((cest[String(id)]?.[k] as number) || 0), 0)
  const uncovered = (id: number) => (cest[String(id)]?.ref_accounts || []).filter(h => !handles.includes(h))
  const partialRefs = refMode !== 'none' && csel.some(id => uncovered(id).length > 0)
  // only the reels whose account isn't in the export travel on their own
  const part = (k: 'n' | 'videos' | 'videos_n') => csel.reduce((a, id) => { const e = cest[String(id)]; return a + uncovered(id).reduce((b, h) => b + (e?.ref_by_account?.[h]?.[k] || 0), 0) }, 0)
  const total = sum('core') + PARTS.reduce((a, p) => a + (inc[p.key] ? sum(p.key) : 0), 0) + csum('core')
    + (inc.client_files ? csum('files') : 0) + (partialRefs ? part('n') * 6000 : 0) + (partialRefs && inc.ref_videos ? part('videos') : 0)
  const toggle = (h: string) => setSel(s => s.includes(h) ? s.filter(x => x !== h) : [...s, h])
  const ctoggle = (id: number) => setCsel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const start = async () => {
    setErr(null)
    try { await api.transferExport(handles, inc, csel, refMode === 'none' ? 'none' : 'reels'); setRunning(true) } catch (e: any) { setErr(e.message) }
  }
  const label = [handles.length ? `${handles.length} account${handles.length === 1 ? '' : 's'}` : null, csel.length ? `${csel.length} ${(csel.length === 1 ? words.one : words.many).toLowerCase()}` : null].filter(Boolean).join(' and ')
  const title = client != null ? `Export ${one?.name || cls.find(c => c.id === client)?.name || ''}` : 'Export'

  return (
    <Sheet title={title} onClose={onClose} busy={running}>
      {client == null && <div className="caption" style={{ lineHeight: 1.5 }}>Packs reference accounts and {words.many.toLowerCase()} into one <span className="mono">.reely</span> file in Downloads. Import it in Reely on another Mac.</div>}
      {done ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="notebox" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <div className="ic green" style={{ width: 32, height: 32 }}>{I.check({ width: 15, height: 15 })}</div>
            <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 13 }}>Exported {[done.clinics.length ? `${done.clinics.length} account${done.clinics.length === 1 ? '' : 's'}` : null, done.clients?.length ? done.clients.join(', ') : null].filter(Boolean).join(' and ')} · {fmt.bytes(done.bytes)}</b><div className="caption" style={{ wordBreak: 'break-all' }}>{done.path.replace(/^\/Users\/[^/]+/, '~')}</div></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Done</button></div>
        </div>
      ) : <>
        {client == null && <div>
          <div className="sechead" style={{ padding: '0 2px 6px' }}><span>Reference accounts · {sel.length} of {clinics.length}</span>
            <button className="linkbtn" onClick={() => setSel(sel.length === clinics.length ? [] : clinics.map(c => c.handle))}>{sel.length === clinics.length ? 'Select none' : 'Select all'}</button></div>
          <div className="group checklist" style={{ boxShadow: 'none', background: 'var(--c-bg)', maxHeight: 190, overflow: 'auto' }}>
            {clinics.map(c => <Row key={c.handle} checked={sel.includes(c.handle)} onChange={() => toggle(c.handle)} disabled={running} title={c.display_name && c.display_name !== c.handle ? <>{c.display_name} <span className="caption" style={{ fontWeight: 400 }}>@{c.handle}</span></> : c.handle}
              sub={`${c.speciality || 'No speciality'} · ${(c.reels_total || 0).toLocaleString()} reels · ${c.analysed} analysed`}
              size={est[c.handle] ? fmt.bytes(est[c.handle].core + PARTS.reduce((a, p) => a + (inc[p.key] ? est[c.handle][p.key] : 0), 0)) : ''} />)}
          </div>
        </div>}

        {client == null && cls.length > 0 && <div>
          <div className="sechead" style={{ padding: '0 2px 6px' }}><span>{words.many} · {csel.length} of {cls.length}</span>
            <button className="linkbtn" onClick={() => setCsel(csel.length === cls.length ? [] : cls.map(c => c.id))}>{csel.length === cls.length ? 'Select none' : 'Select all'}</button></div>
          <div className="group checklist" style={{ boxShadow: 'none', background: 'var(--c-bg)', maxHeight: 190, overflow: 'auto' }}>
            {cls.map(c => {
              const e = cest[String(c.id)], miss = uncovered(c.id)
              return <Row key={c.id} checked={csel.includes(c.id)} onChange={() => ctoggle(c.id)} disabled={running} title={c.name}
                sub={e ? <>{cmeta(e)}{e.refs_n > 0 && <div style={{ color: miss.length ? 'var(--c-amber)' : 'var(--c-green)', fontWeight: 600, marginTop: 2 }}>{miss.length ? `${miss.reduce((a, h) => a + (e.ref_by_account?.[h]?.n || 0), 0)} of its ${e.refs_n} reference reels are from ${miss.join(', ')}; they come along on their own` : `✓ Its scripts use ${e.refs_n} reels from ${e.ref_accounts.length} account${e.ref_accounts.length === 1 ? '' : 's'}, all ticked above`}</div>}</> : '…'}
                size={e ? fmt.bytes(e.core + (inc.client_files ? e.files : 0)) : ''} />
            })}
          </div>
        </div>}

        {client != null && one && <>
          <div className="notebox" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}><b>{one.name}</b><div className="caption">{cmeta(one)}</div></div><span className="caption">{fmt.bytes(one.core)}</span>
          </div>
          {one.refs_n > 0 && <div>
            <div className="sechead" style={{ padding: '0 2px 6px' }}>The reels its scripts were written from</div>
            <div className="group" style={{ boxShadow: 'none', background: 'var(--c-bg)' }}>
              <Row radio checked={refMode === 'reels'} onChange={() => setRefMode('reels')} disabled={running} title={<>Just those reels <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--c-tint)', marginLeft: 4 }}>RECOMMENDED</span></>}
                sub={`${one.refs_n} reels from ${one.ref_accounts.length} account${one.ref_accounts.length === 1 ? '' : 's'}, with their hooks, notes and transcripts. Every script still shows its reference on the other Mac.`} size={fmt.bytes(one.ref_reels_size)} />
              <Row radio checked={refMode === 'accounts'} onChange={() => setRefMode('accounts')} disabled={running} title="Their whole accounts"
                sub={`${one.ref_accounts.join(', ')}. Use this to plan more scripts on the other Mac.`} size={fmt.bytes(sum('core', one.ref_accounts) + (inc.transcripts ? sum('transcripts', one.ref_accounts) : 0))} />
              <Row radio checked={refMode === 'none'} onChange={() => setRefMode('none')} disabled={running} title="Leave them out" sub="The other Mac already has these accounts." size="—" />
            </div>
          </div>}
        </>}

        <div>
          <div className="sechead" style={{ padding: '0 2px 6px' }}>{client != null ? 'Also include' : 'What to include'}</div>
          <div className="group" style={{ boxShadow: 'none', background: 'var(--c-bg)' }}>
            {handles.length > 0 && <>
              <Row checked disabled title="Reel data and analysis" sub="Views, likes, captions, hooks, formats, notes and your edits · always included" size={fmt.bytes(sum('core'))} />
              {PARTS.map(p => <Row key={p.key} checked={inc[p.key]} onChange={() => setInc(x => ({ ...x, [p.key]: !x[p.key] }))} disabled={running} title={p.label}
                sub={<>{p.desc}{p.key === 'videos' && sum('videos_n') ? ` · ${sum('videos_n').toLocaleString()} files` : ''}</>} size={fmt.bytes(sum(p.key))} />)}
            </>}
            {csel.length > 0 && <Row checked={inc.client_files} onChange={() => setInc(x => ({ ...x, client_files: !x.client_files }))} disabled={running} title={`${words.one} files`}
              sub={`PDFs, images and documents added to ${csel.length === 1 ? 'this ' + words.one.toLowerCase() : words.many.toLowerCase()} · ${csum('files_n')} file${csum('files_n') === 1 ? '' : 's'}`} size={fmt.bytes(csum('files'))} />}
            {partialRefs && <Row checked={inc.ref_videos} onChange={() => setInc(x => ({ ...x, ref_videos: !x.ref_videos }))} disabled={running} title="Reference videos"
              sub={`Videos of the reference reels that come along on their own, so Watch works on the other Mac · ${part('videos_n')} of ${part('n')} on this Mac`} size={'~' + fmt.bytes(part('videos'))} />}
          </div>
        </div>
        {err && <div className="err">{err}</div>}
        {running ? <Progress job={job} /> : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="caption">About {fmt.bytes(total)}</span>
            <span className="spacer" />
            <button className="btn plain" onClick={onClose}>Cancel</button>
            <button className="btn" onClick={start} disabled={!handles.length && !csel.length}>{client != null ? 'Export' : `Export ${label || 'nothing'}`}</button>
          </div>
        )}
      </>}
    </Sheet>
  )
}

export function ImportSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const nameOf = useName()
  const { words } = useContext(Ui)
  const nav = useNavigate()
  const [info, setInfo] = useState<any>(null)
  const [sel, setSel] = useState<string[]>([])
  const [csel, setCsel] = useState<string[]>([])
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<any>(null)
  const [job] = useJob(running, j => { setRunning(false); if (j.status === 'done') { setDone(j.result); onDone() } else setErr(j.error || 'Import failed') })
  const conflicts = useMemo(() => (info?.clinics || []).filter((c: any) => sel.includes(c.handle) && c.exists), [info, sel])
  const cconflicts = useMemo(() => (info?.clients || []).filter((c: any) => csel.includes(c.uid) && c.exists), [info, csel])

  const choose = async () => {
    setErr(null)
    let path: string | null = null
    if (isTauri) {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const r = await open({ multiple: false, directory: false, title: 'Choose a Reely export', filters: [{ name: 'Reely export', extensions: ['reely', 'zip'] }] })
      path = typeof r === 'string' ? r : null
    } else path = window.prompt('Path to the .reely file')
    if (!path) return
    try { const i = await api.transferInspect(path); setInfo(i); setSel(i.clinics.map((c: any) => c.handle)); setCsel((i.clients || []).map((c: any) => c.uid)) } catch (e: any) { setErr(e.message); setInfo(null) }
  }
  const start = async () => { setErr(null); try { await api.transferImport(info.path, sel, mode, csel); setRunning(true) } catch (e: any) { setErr(e.message) } }
  const partChips = (inc: any) => [['Reel data', true], ['Transcripts', inc?.transcripts], ['Insights', inc?.insights], ['Ask threads', inc?.chat], ['Videos', inc?.videos]] as [string, boolean][]
  const cc = (c: any) => [c.people ? `${c.people} ${c.people === 1 ? 'person' : 'people'}` : null, c.branches ? `${c.branches} branch${c.branches === 1 ? '' : 'es'}` : null, c.sources != null ? `${c.sources} sources` : null, c.files ? `${c.files} files` : null, c.brief ? 'brief' : null, c.plans ? `${c.plans} plan${c.plans === 1 ? '' : 's'}` : null, c.scripts != null ? `${c.scripts} scripts` : null].filter(Boolean).join(' · ')
  const count = sel.length + csel.length
  const label = [sel.length ? `${sel.length} account${sel.length === 1 ? '' : 's'}` : null, csel.length ? `${csel.length} ${(csel.length === 1 ? words.one : words.many).toLowerCase()}` : null].filter(Boolean).join(' and ')

  return (
    <Sheet title="Import" onClose={onClose} busy={running}>
      {done ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(done.clients || []).length > 0 && <>
            <div className="sechead" style={{ padding: '0 2px' }}>{words.many}</div>
            {done.clients.map((c: any) => {
              const a = c.added || {}, bits = [a.scripts ? `${a.scripts} scripts` : null, a.plans ? `${a.plans} plan${a.plans === 1 ? '' : 's'}` : null, a.files ? `${a.files} files` : null, a.sources ? `${a.sources} sources` : null, a.people ? `${a.people} people` : null].filter(Boolean)
              return (
                <div key={c.id} className="notebox" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                  <div className="ic green" style={{ width: 30, height: 30 }}>{I.check({ width: 14, height: 14 })}</div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <b style={{ fontSize: 13 }}>{c.name} · {c.action}</b>
                    <div className="caption" style={{ lineHeight: 1.5 }}>{bits.length ? `Added ${bits.join(', ')}.` : 'Nothing new to add.'}{c.action === 'merged' ? ` Kept your brief${c.kept_scripts ? ` and ${c.kept_scripts} scripts` : ''}.` : ''} {c.refs ? (c.refs_missing ? `${c.refs - c.refs_missing} of ${c.refs} reference reels are here.` : `All ${c.refs} reference reels are here.`) : ''}</div>
                    <button className="linkbtn" style={{ alignSelf: 'flex-start', fontSize: 12.5 }} onClick={() => { onClose(); nav(`/clients/${c.id}`) }}>Open {c.name} ›</button>
                  </div>
                </div>
              )
            })}
          </>}
          {done.clinics.length > 0 && <div className="sechead" style={{ padding: '4px 2px 0' }}>Reference accounts</div>}
          {done.clinics.map((c: any) => (
            <div key={c.handle} className="notebox" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <div className={'ic ' + (c.skipped ? '' : 'green')} style={{ width: 30, height: 30 }}>{c.skipped ? '!' : I.check({ width: 14, height: 14 })}</div>
              <div style={{ flex: 1 }}><b style={{ fontSize: 13 }}>{nameOf(c.handle)}</b><div className="caption">{c.skipped ? `Skipped · ${c.skipped}` : `${c.added} files added${c.kept ? ` · ${c.kept} already here, kept` : ''}`}</div></div>
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
        {info.clinics.length > 0 && <div>
          <div className="sechead" style={{ padding: '0 2px 6px' }}>Reference accounts · {info.clinics.length}</div>
          <div className="group" style={{ boxShadow: 'none', background: 'var(--c-bg)', maxHeight: 220, overflow: 'auto' }}>
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
        </div>}
        {(info.clients || []).length > 0 && <div>
          <div className="sechead" style={{ padding: '0 2px 6px' }}>{words.many} · {info.clients.length}</div>
          <div className="group" style={{ boxShadow: 'none', background: 'var(--c-bg)', maxHeight: 220, overflow: 'auto' }}>
            {info.clients.map((c: any) => (
              <label key={c.uid} className="grow" style={{ padding: '10px 14px', cursor: 'pointer', alignItems: 'flex-start' }}>
                <input type="checkbox" checked={csel.includes(c.uid)} onChange={() => setCsel(s => s.includes(c.uid) ? s.filter(x => x !== c.uid) : [...s, c.uid])} disabled={running} style={{ marginTop: 3 }} />
                <div className="fill" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name} {c.exists && <span className="pill amber" style={{ padding: '1px 7px', fontSize: 10.5, marginLeft: 4 }}>Already on this Mac</span>}</div>
                  <div className="caption">{c.exists ? 'In the file: ' : ''}{cc({ ...c.counts, files: c.files_included ? c.counts.files : 0 })}</div>
                  {c.local && <div className="caption">On this Mac: {cc(c.local)}</div>}
                </div>
              </label>
            ))}
          </div>
          {info.ref_reels > 0 && <div className="caption" style={{ padding: '6px 2px 0' }}>Brings {info.ref_reels} reference reels for their scripts. They show on the scripts, not in Reels or Overview.</div>}
        </div>}
        {(conflicts.length > 0 || cconflicts.length > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="seg" style={{ alignSelf: 'flex-start' }}>
              <button className={mode === 'merge' ? 'on' : ''} onClick={() => setMode('merge')} disabled={running}>Merge</button>
              <button className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')} disabled={running}>Replace</button>
            </div>
            <div className="notebox" style={{ gap: 3, fontSize: 12.5, lineHeight: 1.5 }}>{mode === 'merge' ? <>
              <b>Merge keeps everything on this Mac and adds what's missing.</b>
              {cconflicts.map((c: any) => <span key={c.uid}>· {c.name} gets the people, branches, sources, files, plans and scripts it doesn't have; your brief and edits win.</span>)}
              {conflicts.length > 0 && <span>· {conflicts.map((c: any) => c.handle).join(', ')} {conflicts.length === 1 ? 'gets' : 'get'} only the reels and files {conflicts.length === 1 ? "it doesn't" : "they don't"} have.</span>}
            </> : <><b style={{ color: 'var(--c-red)' }}>Replace deletes these on this Mac and uses the file's copy:</b><span>{[...cconflicts.map((c: any) => c.name), ...conflicts.map((c: any) => c.handle)].join(', ')}, including {cconflicts.length ? 'scripts, plans and files' : ''}{cconflicts.length && conflicts.length ? ', ' : ''}{conflicts.length ? 'videos and threads' : ''}.</span></>}</div>
          </div>
        )}
        {err && <div className="err">{err}</div>}
        {running ? <Progress job={job} /> : (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn plain" onClick={onClose}>Cancel</button>
            <button className={'btn' + (mode === 'replace' && (conflicts.length || cconflicts.length) ? ' danger' : '')} onClick={start} disabled={!count}>Import {label}</button>
          </div>
        )}
      </>}
    </Sheet>
  )
}
