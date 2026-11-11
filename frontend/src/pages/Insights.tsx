import { useContext, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ClinicPicker, HoldButton, SpecialityPicker, Toolbar, Ui } from '../App'
import { api, fmt } from '../api'
import { I } from '../icons'

const ALL = '_all'

export default function Insights() {
  const { handle: hParam } = useParams()
  const { spec, clinics } = useContext(Ui)
  const [handle, setHandle] = useState(hParam || localStorage.getItem('reely.insights.clinic') || ALL)
  const [data, setData] = useState<{ stats: any; markdown: string | null } | null>(null)
  const [chat, setChat] = useState<{ role: string; text: string }[]>([])
  const [q, setQ] = useState('')
  const [asking, setAsking] = useState(false)
  const [tab, setTab] = useState<'summary' | 'doc' | 'report'>('summary')
  const [claudeOk, setClaudeOk] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { api.tools().then(t => setClaudeOk(!!t.claude?.installed)) }, [])
  useEffect(() => { if (hParam) setHandle(hParam) }, [hParam])
  useEffect(() => { localStorage.setItem('reely.insights.clinic', handle) }, [handle])
  useEffect(() => { if (spec && handle !== ALL && clinics.length && clinics.find(c => c.handle === handle)?.speciality !== spec) setHandle(ALL) }, [spec, clinics])
  useEffect(() => {
    setData(null)
    api.insights(handle, spec && handle === ALL ? { speciality: spec } : {}).then(setData)
    api.chat(handle).then(setChat)
    if (handle === ALL && tab === 'doc') setTab('summary')
    if (handle !== ALL && tab === 'report') setTab('summary')
  }, [handle, spec])
  const isAll = handle === ALL
  const scopeLabel = isAll ? (spec ? `${spec} clinics` : 'all clinics') : handle
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [chat, asking])
  const [elapsed, setElapsed] = useState(0)
  const [askOpen, setAskOpenState] = useState(() => localStorage.getItem('reely.ask.open') !== '0')
  const setAskOpen = (v: boolean) => { setAskOpenState(v); localStorage.setItem('reely.ask.open', v ? '1' : '0') }
  // resume a question that was still being answered when the page was left
  useEffect(() => { api.askStatus(handle).then(s => { if (s.status === 'running') { setAsking(true); setElapsed(s.elapsed || 0) } }).catch(() => {}) }, [handle])
  // poll while Claude is answering; the reply is written to the thread on the backend
  useEffect(() => {
    if (!asking) return
    const t = setInterval(async () => {
      const s = await api.askStatus(handle).catch(() => null)
      if (!s) return
      if (s.status === 'running') setElapsed(s.elapsed || 0)
      else { setAsking(false); setElapsed(0); api.chat(handle).then(setChat) }
    }, 2000)
    return () => clearInterval(t)
  }, [asking, handle])

  const ask = async () => {
    if (!q.trim() || asking) return
    const question = q; setQ('')
    setChat(c => [...c, { role: 'user', text: question }])
    try { await api.ask(handle, question); setAsking(true); setElapsed(0) }
    catch (e: any) { setChat(c => [...c, { role: 'assistant', text: 'Error: ' + e.message }]) }
  }

  const s = data?.stats
  const med = s?.median_like_rate
  const formats: [string, number][] = s ? Object.entries(s.formats as Record<string, number>) : []
  const maxF = formats[0]?.[1] || 1
  const byFlag: [string, number][] = s ? Object.entries(s.like_rate_by_flag as Record<string, number>).sort((a, b) => b[1] - a[1]) : []
  const hooks: [string, number][] = s ? Object.entries(s.hook_types as Record<string, number>).slice(0, 6) : []

  return (
    <>
      <Toolbar title="Insights">
        <SpecialityPicker />
        <ClinicPicker value={handle} onChange={setHandle} bold />
        {!isAll && <div className="seg"><button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>Summary</button><button className={tab === 'doc' ? 'on' : ''} onClick={() => setTab('doc')}>INSIGHTS.md</button></div>}
        {isAll && <div className="seg"><button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>Summary</button><button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>{spec ? 'Speciality report' : 'All-clinics report'}</button></div>}
        <button className="btn plain" onClick={() => api.reveal(isAll ? '' : handle)}>Reveal folder</button>
      </Toolbar>
      <div className="main"><div className="main-inner">
        <div>
          <h1 className="large">Insights</h1>
          <div className="lead">{isAll
            ? <>What the top reels across {scopeLabel} have in common{s?.clinics?.length ? <> · {s.clinics.length} clinic{s.clinics.length === 1 ? '' : 's'}</> : null}.</>
            : <>What {handle}'s top reels have in common, and what actually earned engagement.</>}</div>
        </div>

        <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="ic tint" style={{ width: 28, height: 28, borderRadius: 8 }}>{I.spark({ width: 14, height: 14 })}</div>
            <b style={{ fontSize: 14 }}>Ask Claude about {isAll ? 'these clinics' : 'this clinic'}</b>
            <span className="caption">{!askOpen && asking ? `Answering… ${elapsed}s` : !askOpen && chat.length ? `${chat.length} message${chat.length === 1 ? '' : 's'} in this thread` : claudeOk ? 'Runs on your Claude plan via the CLI · thread kept per clinic · answers can take a minute' : 'Claude Code CLI not installed · see Models'}</span>
            <span className="spacer" />
            {askOpen && chat.length > 0 && !asking && <HoldButton className="btn plain sm" label="Clear thread" holdLabel="Hold…" ms={1500} onHold={async () => { await api.clearChat(handle); setChat([]) }} />}
            <button className="iconbtn" aria-label={askOpen ? 'Minimise' : 'Expand'} aria-expanded={askOpen} title={askOpen ? 'Minimise' : 'Expand'} onClick={() => setAskOpen(!askOpen)}>{askOpen ? I.up() : I.down()}</button>
          </div>
          {askOpen && <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 360, overflow: 'auto' }}>
            {chat.length === 0 && !asking && clinics.find(c => c.handle === handle)?.imported?.chat === false && <div className="caption">The Ask Claude thread was not included in the import; new questions start a fresh thread.</div>}
            {chat.length === 0 && !asking && <div className="caption">Ask anything about the hooks, formats or like-rates here. Answers are kept as a thread per clinic.</div>}
            {chat.map((m, i) => <div key={i} className={'bubble ' + (m.role === 'user' ? 'me' : 'ai')}>{m.text}</div>)}
            {asking && <div className="bubble ai caption" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="ic spinner" style={{ width: 16, height: 16, flexBasis: 16 }}><span style={{ width: 12, height: 12, borderWidth: 1.5 }} /></span>Claude is reading the {isAll ? "clinics' files" : 'clinic files'}… {elapsed}s</div>}
            <div ref={endRef} />
          </div>
          <form style={{ display: 'flex', gap: 8 }} onSubmit={e => { e.preventDefault(); ask() }}>
            <input className="field" style={{ flex: 1, height: 36, border: 0, padding: '0 14px', fontSize: 13, outline: 0 }} placeholder={isAll ? 'Which hook types work across these clinics?' : 'Which of these hooks would work for a single-chair clinic?'} value={q} onChange={e => setQ(e.target.value)} disabled={!claudeOk} />
            <button className="btn" type="submit" disabled={asking || !claudeOk || !q.trim()}>{asking ? 'Answering…' : 'Send'}</button>
          </form>
          </>}
        </div>
        {tab === 'report' && isAll ? <ReportView spec={spec || null} /> : tab === 'doc' ? (
          <div className="card pad md" style={{ padding: '28px 32px' }}>
            {data?.markdown ? <Markdown text={data.markdown} /> : <div className="empty">{clinics.find(c => c.handle === handle)?.imported?.insights === false ? 'INSIGHTS.md was not included in the import this clinic came from.' : 'No INSIGHTS.md yet. It is written at the end of a run when annotation is on.'}</div>}
          </div>
        ) : (
          <>
            <div className="card pad" style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', gap: 28, alignItems: 'center', background: '#1D1D1F', color: '#fff' }}>
              <div><div className="caption" style={{ color: '#A1A1A6', fontWeight: 600 }}>Median like-rate</div><div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-.045em', lineHeight: 1, marginTop: 6 }}>{med != null ? med.toFixed(2) : '—'}<span style={{ fontSize: 22, color: '#A1A1A6', letterSpacing: 0 }}>%</span></div></div>
              <div style={{ fontSize: 15, lineHeight: 1.5, color: '#D1D1D6' }}>
                {med == null ? 'Run a clinic to see this.' : med < 0.3
                  ? <>Organic reels run 1–5%. Every bucket here sits far below that, so these views were promoted. <strong style={{ color: '#fff' }}>Rank by like-rate, not views.</strong></>
                  : med < 1 ? <>Below the 1–5% organic band, so a good share of reach was paid. <strong style={{ color: '#fff' }}>Like-rate separates the creative that worked.</strong></>
                  : <>Inside the organic band. <strong style={{ color: '#fff' }}>Views and like-rate agree here, so both rankings are useful.</strong></>}
              </div>
              {byFlag.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '6px 18px', fontSize: 12.5, color: '#D1D1D6', background: 'rgba(255,255,255,.07)', borderRadius: 12, padding: '12px 16px' }}>
                {byFlag.map(([k, v], i) => <><span key={k + 'k'}>{k}</span><span key={k + 'v'} style={{ textAlign: 'right', color: i === 0 ? '#fff' : undefined, fontWeight: i === 0 ? 600 : 400 }}>{v.toFixed(3)}%</span></>)}
              </div>}
            </div>

            <div className="grid2" style={{ alignItems: 'start' }}>
              <div>
                <div className="sechead">Formats in the top reels</div>
                <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {formats.length === 0 && <div className="caption">Annotate the clinic to see formats.</div>}
                  {formats.map(([k, v]) => (
                    <div key={k} style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr) 30px', gap: 12, alignItems: 'center', fontSize: 13 }}>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k}</span>
                      <div className="bar" style={{ height: 8 }}><div style={{ width: `${(v / maxF) * 100}%`, background: /pageant|celeb|kbc/.test(k) ? '#FEBC2E' : /influencer/.test(k) ? '#8B6FEA' : /milestone|silent/.test(k) ? 'var(--c-fill2)' : 'var(--c-tint)' }} /></div>
                      <b style={{ textAlign: 'right' }}>{v}</b>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="sechead">Reels that resonated</div>
                <div className="group">
                  {(s?.top_like_rate || []).slice(0, 6).map((r: any) => (
                    <div key={r.shortcode} className="grow">
                      <div className="lr" style={{ color: 'var(--c-green)' }}>{r.like_rate_pct?.toFixed(2)}%</div>
                      <div className="fill"><div className="t" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.hook_en || r.hook_spoken_original}</div><div className="s">{[isAll ? r.clinic : null, r.format, fmt.n(r.views) + ' views'].filter(Boolean).join(' · ')}</div></div>
                    </div>
                  ))}
                  {hooks.length > 0 && <div className="grow" style={{ flexWrap: 'wrap', gap: 6 }}><span className="caption" style={{ width: '100%' }}>Hook types</span>{hooks.map(([k, v]) => <span key={k} className="chip">{k} · {v}</span>)}</div>}
                </div>
              </div>
            </div>
          </>
        )}

      </div></div>
    </>
  )
}

/** Small markdown renderer: headings, paragraphs, lists, tables, bold, code. */
function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let i = 0, key = 0
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, j) => p.startsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : p.startsWith('`') ? <code key={j}>{p.slice(1, -1)}</code> : p)
  while (i < lines.length) {
    const l = lines[i]
    if (/^#{1,3} /.test(l)) { const n = l.match(/^#+/)![0].length; const T = (`h${n}`) as any; out.push(<T key={key++}>{inline(l.replace(/^#+ /, ''))}</T>); i++; continue }
    if (l.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].startsWith('|')) { if (!/^\|[\s:-]+\|/.test(lines[i])) rows.push(lines[i].split('|').slice(1, -1).map(c => c.trim())); i++ }
      out.push(<table key={key++}><thead><tr>{rows[0]?.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{rows.slice(1).map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody></table>); continue
    }
    if (/^(\d+\.|-|\*) /.test(l)) {
      const items: string[] = []; const ordered = /^\d+\./.test(l)
      while (i < lines.length && /^(\d+\.|-|\*) /.test(lines[i])) { items.push(lines[i].replace(/^(\d+\.|-|\*) /, '')); i++ }
      const L = ordered ? 'ol' : 'ul'; out.push(<L key={key++}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</L>); continue
    }
    if (l.trim() === '') { i++; continue }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3} |\||\d+\. |- |\* )/.test(lines[i])) { para.push(lines[i]); i++ }
    out.push(<p key={key++}>{inline(para.join(' '))}</p>)
  }
  return <>{out}</>
}

/** Speciality report: generated by Claude only when asked; regenerating replaces it. */
function ReportView({ spec }: { spec: string | null }) {
  const [r, setR] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = () => api.report(spec).then(setR).catch(e => setErr(e.message))
  useEffect(() => { setR(null); setErr(null); load() }, [spec])
  const running = r?.job?.status === 'running'
  useEffect(() => { if (!running) return; const t = setInterval(load, 3000); return () => clearInterval(t) }, [running, spec])
  const gen = async () => { setErr(null); try { await api.reportGenerate(spec); load() } catch (e: any) { setErr(e.message) } }
  const name = spec ? `${spec} report` : 'All-clinics report'
  const newClinics = r ? r.available.filter((h: string) => !r.clinics.includes(h)) : []
  return (
    <div className="card pad md" style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="ic tint" style={{ width: 30, height: 30, borderRadius: 9 }}>{I.spark({ width: 14, height: 14 })}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 15 }}>{name}</b>
          <div className="caption">{!r ? 'Loading…' : r.markdown ? `Written ${fmt.date(r.generated)} ${fmt.time(r.generated?.replace('T', ' '))} from ${r.clinics.length} clinic${r.clinics.length === 1 ? '' : 's'}${newClinics.length ? ` · ${newClinics.length} analysed since, not included` : ''}` : `Compares ${r.available.length} analysed clinic${r.available.length === 1 ? '' : 's'}. Written by Claude on your plan, only when you ask.`}</div>
        </div>
        {running
          ? <span className="caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="ic spinner" style={{ width: 16, height: 16, flexBasis: 16 }}><span style={{ width: 12, height: 12, borderWidth: 1.5 }} /></span>Claude is writing… {r.job.elapsed}s</span>
          : <button className={r?.markdown ? 'btn plain' : 'btn'} onClick={gen} disabled={!r || r.available.length === 0}>{r?.markdown ? 'Regenerate' : 'Generate report'}</button>}
      </div>
      {(err || r?.job?.status === 'error') && <div className="err">{err || r.job.error}</div>}
      {r?.markdown ? <div style={{ borderTop: '1px solid var(--c-hair)', paddingTop: 6 }}><Markdown text={r.markdown} /></div>
        : r && !running && <div className="empty" style={{ padding: 24 }}>{r.available.length ? 'No report yet. Generating takes a few minutes and reads every clinic in this speciality.' : 'No analysed clinics here yet.'}</div>}
    </div>
  )
}
