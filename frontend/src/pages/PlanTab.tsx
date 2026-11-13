import { useContext, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { HoldButton, Ui, useName } from '../App'
import { api, fmt, LANGS } from '../api'
import type { ClientDoc, Pattern, Plan, PlanItem } from '../api'
import { I } from '../icons'

const monthOptions = () => {
  const d = new Date(), out: { v: string; l: string }[] = []
  for (let i = 0; i < 4; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() + i, 1)
    out.push({ v: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, l: m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) })
  }
  return out
}
const monthName = (v: string) => { const [y, m] = v.split('-').map(Number); return y && m ? new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : v }

/** Split `count` scripts across languages in the brief's mix (e.g. Telugu 70 / English 30), largest remainder first. */
function defaultMix(c: ClientDoc, count: number): Record<string, number> {
  const mix: { lang: string; pct: number }[] = (c.brief?.voice?.mix || []).filter((x: any) => x?.lang && x.pct > 0)
  const base = mix.length ? mix : (c.languages.length ? c.languages : ['en']).map((l, i, a) => ({ lang: l, pct: i === 0 && a.length > 1 ? 70 : 100 / a.length }))
  const total = base.reduce((a, x) => a + x.pct, 0) || 1
  const raw = base.map(x => ({ lang: x.lang, n: count * x.pct / total }))
  const out: Record<string, number> = Object.fromEntries(raw.map(x => [x.lang, Math.floor(x.n)]))
  let left = count - Object.values(out).reduce((a, b) => a + b, 0)
  for (const x of [...raw].sort((a, b) => (b.n % 1) - (a.n % 1))) { if (left <= 0) break; out[x.lang]++; left-- }
  return out
}

export default function PlanTab({ c, onScripts }: { c: ClientDoc; onScripts: () => void }) {
  const { toast } = useContext(Ui)
  const nav = useNavigate()
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [pid, setPid] = useState<number | null>(null)
  const [pats, setPats] = useState<Awaited<ReturnType<typeof api.patterns>> | null>(null)
  const [showPats, setShowPats] = useState(false)
  const [form, setForm] = useState(false)

  const load = () => api.plans(c.id).then(p => { setPlans(p); setPid(x => x && p.some(q => q.id === x) ? x : p[0]?.id ?? null); if (!p.length) setForm(true) }).catch(() => setPlans([]))
  const loadPats = () => api.patterns(c.speciality).then(setPats).catch(() => {})
  useEffect(() => { load(); loadPats() }, [c.id])
  const plan = plans?.find(p => p.id === pid) || null
  const busy = plans?.some(p => p.status === 'proposing') || plan?.items.some(i => i.script_status === 'queued' || i.script_status === 'generating')
  const mining = pats?.job?.status === 'running'
  useEffect(() => {
    if (!busy && !mining) return
    const t = setInterval(() => { load(); loadPats(); onScripts() }, 3500); return () => clearInterval(t)
  }, [busy, mining])

  if (!c.brief) return <div className="card pad" style={{ maxWidth: 680 }}><b style={{ fontSize: 16 }}>Draft the brief first</b><div className="sub" style={{ marginTop: 6, lineHeight: 1.5 }}>A plan mixes the patterns that work in {c.speciality || 'this speciality'} with this client's services, patients' questions and limits, so it needs the brief on the Context tab.</div></div>

  const savePlan = async (items: PlanItem[]) => { if (!plan) return; setPlans(ps => ps && ps.map(p => p.id === plan.id ? { ...p, items } : p)); try { await api.planEdit(plan.id, items) } catch (e: any) { toast(e.message) } }
  const setItem = (id: string, patch: Partial<PlanItem>) => plan && savePlan(plan.items.map(i => i.id === id ? { ...i, ...patch } : i))
  const ticked = plan?.items.filter(i => i.tick && !i.script_id) || []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PatternsCard c={c} pats={pats} open={showPats} setOpen={setShowPats} reload={loadPats} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {plans && plans.length > 0 && <div className="field" style={{ height: 30 }}><select value={pid ?? ''} onChange={e => setPid(Number(e.target.value))} aria-label="Plan">{plans.map(p => <option key={p.id} value={p.id}>{monthName(p.month)} · {p.count} scripts · {fmt.date(p.created_at)}</option>)}</select></div>}
        <span className="spacer" />
        {!form && <button className="btn plain sm" onClick={() => setForm(true)}>{I.plus()} New plan</button>}
      </div>

      {form && <NewPlanForm c={c} hasPlans={!!plans?.length} onCancel={() => setForm(false)} onMade={p => { setForm(false); setPlans(ps => [p, ...(ps || [])]); setPid(p.id) }} />}

      {plan && plan.status === 'proposing' && (
        <div className="card pad" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="ic spinner" style={{ width: 18, height: 18, flexBasis: 18 }}><span style={{ width: 16, height: 16 }} /></span>
          <div><b>Planning {plan.count} scripts for {monthName(plan.month)}</b><div className="caption">{plan.note || 'Working…'} Usually a minute or two.</div></div>
        </div>
      )}
      {plan && plan.status === 'failed' && (
        <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <b>This plan didn't finish</b><div className="err" style={{ alignSelf: 'stretch' }}>{plan.error}</div>
          <div style={{ display: 'flex', gap: 8 }}><button className="btn sm" onClick={async () => { await api.planRetry(plan.id); load() }}>Try again</button><HoldButton label="Delete plan" ms={1200} onHold={async () => { await api.planDelete(plan.id); load() }} className="btn plain sm" /></div>
        </div>
      )}
      {plan && plan.status === 'ready' && (
        <div className="group">
          <div className="grouphead">
            <b>{monthName(plan.month)}</b>
            <span className="caption">{plan.items.length} proposed · {plan.items.filter(i => i.tick || i.script_id).length} chosen · {Object.entries(plan.items.reduce((a: Record<string, number>, i) => { a[i.language] = (a[i.language] || 0) + 1; return a }, {})).map(([l, n]) => `${n} ${LANGS[l] || l}`).join(', ')}</span>
            <span className="spacer" />
            <HoldButton label="Delete plan" ms={1500} onHold={async () => { await api.planDelete(plan.id); load() }} className="btn plain sm" />
            <button className="btn sm" disabled={!ticked.length} onClick={async () => { try { const r = await api.planGenerate(plan.id); toast(`${r.queued} script${r.queued === 1 ? '' : 's'} queued · two are written at a time`); load(); onScripts() } catch (e: any) { toast(e.message) } }}>{I.spark({ width: 12, height: 12 })} Generate {ticked.length} ticked</button>
          </div>
          <div className="planrow head"><span /><span>Topic</span><span>Pattern</span><span>Language</span><span>Voice and cast</span><span>Why</span></div>
          {plan.items.map(it => (
            <div key={it.id} className={'planrow' + (it.tick || it.script_id ? '' : ' off')}>
              {it.script_id
                ? <Link to={`/clients/${c.id}/scripts/${it.script_id}`} title="Open the script" className={'pill ' + (it.script_status === 'draft' ? 'grey' : it.script_status === 'approved' ? 'green' : it.script_status === 'review' ? 'tint' : it.script_status === 'failed' ? 'red' : 'amber')} style={{ padding: '1px 7px', fontSize: 10.5, justifySelf: 'start' }}>{it.script_status === 'queued' ? 'waiting' : it.script_status === 'generating' ? 'writing' : it.script_status === 'review' ? 'doctor' : it.script_status}</Link>
                : <input type="checkbox" checked={!!it.tick} onChange={() => setItem(it.id, { tick: !it.tick })} aria-label={`Include ${it.topic}`} />}
              <div style={{ minWidth: 0 }}>
                <PlanInline value={it.topic} disabled={!!it.script_id} onSave={v => setItem(it.id, { topic: v })} bold />
                <PlanInline value={it.angle || ''} disabled={!!it.script_id} onSave={v => setItem(it.id, { angle: v })} small />
              </div>
              <span className="sub" style={{ fontSize: 12.5 }}>{it.pattern}</span>
              {it.script_id ? <span className="sub" style={{ fontSize: 12.5 }}>{LANGS[it.language] || it.language}</span>
                : <div className="field" style={{ height: 26 }}><select value={it.language} onChange={e => setItem(it.id, { language: e.target.value })} style={{ fontSize: 12 }}>{[...new Set([...c.languages, 'te', 'hi', 'en', it.language])].map(l => <option key={l} value={l}>{LANGS[l] || l}</option>)}</select></div>}
              <div style={{ minWidth: 0 }}>
                {it.script_id ? <span className="sub" style={{ fontSize: 12.5 }}>{c.people.find(p => p.id === it.person_id)?.name || 'Clinic'}</span>
                  : <div className="field" style={{ height: 26 }}><select value={it.person_id || ''} onChange={e => setItem(it.id, { person_id: e.target.value || null })} style={{ fontSize: 12 }}>{c.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="">The clinic</option></select></div>}
                <PlanInline value={it.on_camera || ''} disabled={!!it.script_id} onSave={v => setItem(it.id, { on_camera: v })} small />
              </div>
              <div className="caption" style={{ lineHeight: 1.45 }}>{it.warn ? <span style={{ color: 'var(--c-amber)', fontWeight: 600 }}>{it.warn}</span> : it.why}</div>
            </div>
          ))}
          <div className="caption" style={{ padding: '10px 16px' }}>Click a topic, angle or cast line to change it before generating. Every script gets three hook options.</div>
        </div>
      )}
      {plans && plans.length === 0 && !form && <div className="empty">No plans yet.</div>}
      {plan && plan.items.some(i => i.script_id) && <button className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => nav(`/clients/${c.id}/scripts?plan=${plan.id}`)}>See this plan's scripts ›</button>}
    </div>
  )
}

function PlanInline({ value, onSave, disabled, bold, small }: { value: string; onSave: (v: string) => void; disabled?: boolean; bold?: boolean; small?: boolean }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const style: React.CSSProperties = bold ? { fontWeight: 600, fontSize: 13.5 } : small ? { fontSize: 12, color: 'var(--c-sub)' } : {}
  if (edit) return <input autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={() => { setEdit(false); if (v !== value) onSave(v) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value); setEdit(false) } }} style={{ ...style, width: '100%', border: '1px solid var(--c-tint)', borderRadius: 6, padding: '2px 6px', background: 'var(--c-card)', color: 'inherit', font: 'inherit' }} />
  return <div className={disabled ? '' : 'editable'} style={{ ...style, margin: disabled ? 0 : '-2px -6px', padding: disabled ? 0 : '2px 6px' }} onClick={() => !disabled && setEdit(true)}>{value || (disabled ? '' : <span className="caption">add…</span>)}</div>
}

function NewPlanForm({ c, hasPlans, onCancel, onMade }: { c: ClientDoc; hasPlans: boolean; onCancel: () => void; onMade: (p: Plan) => void }) {
  const months = useMemo(monthOptions, [])
  const [month, setMonth] = useState(months[1]?.v || months[0].v)
  const [count, setCount] = useState(12)
  const [mix, setMix] = useState<Record<string, number>>(() => defaultMix(c, 12))
  const [cast, setCast] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const changeCount = (n: number) => { setCount(n); if (n > 0) setMix(defaultMix(c, n)) }
  const sum = Object.values(mix).reduce((a, b) => a + (b || 0), 0)
  const langs = [...new Set([...Object.keys(mix), ...c.languages])]
  const go = async () => {
    setBusy(true); setErr('')
    try { onMade(await api.planNew(c.id, { month, count, mix, cast, note })) } catch (e: any) { setErr(e.message); setBusy(false) }
  }
  return (
    <form className="card pad planform" onSubmit={e => { e.preventDefault(); go() }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}><b style={{ fontSize: 15 }}>Plan scripts</b><span className="caption">Claude proposes a month; you tick what to write.</span></div>
      <div className="planfields">
        <label className="formrow"><span>How many</span><div className="field"><input type="number" min={1} max={60} value={count} onChange={e => changeCount(parseInt(e.target.value, 10) || 0)} aria-label="How many scripts" /></div></label>
        <label className="formrow"><span>For</span><div className="field"><select value={month} onChange={e => setMonth(e.target.value)}>{months.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}</select></div></label>
        <div className="formrow"><span>Languages <span className="caption" style={{ color: sum === count ? 'var(--c-muted)' : 'var(--c-amber)' }}>{sum} of {count}</span></span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>{langs.map(l => (
            <label key={l} className="mixchip"><span>{LANGS[l] || l}</span><input type="number" min={0} max={count} value={mix[l] ?? 0} onChange={e => setMix({ ...mix, [l]: Math.max(0, parseInt(e.target.value, 10) || 0) })} aria-label={`${LANGS[l] || l} scripts`} /></label>
          ))}<select className="chipsel empty" style={{ height: 30, flex: '0 0 auto', width: 'auto' }} value="" onChange={e => { if (e.target.value) setMix({ ...mix, [e.target.value]: 0 }) }} aria-label="Add a language"><option value="">+ language</option>{Object.entries(LANGS).filter(([k]) => !(k in mix)).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
        </div>
      </div>
      <div className="grid2" style={{ gap: 12 }}>
        <label className="formrow"><span>Who can appear <span className="caption">optional</span></span><div className="field"><input value={cast} onChange={e => setCast(e.target.value)} placeholder={`e.g. ${c.people.find(p => p.lead)?.name || 'the doctor'}, the front desk, actors for skits`} /></div></label>
        <label className="formrow"><span>Anything else <span className="caption">optional</span></span><div className="field"><input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. push egg freezing this month; one reel for the new branch" /></div></label>
      </div>
      {err && <div className="err">{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {hasPlans && <button type="button" className="btn plain" onClick={onCancel}>Cancel</button>}
        <button className="btn" type="submit" disabled={busy || count < 1}>{I.spark({ width: 13, height: 13 })} {busy ? 'Starting…' : `Propose ${count} scripts`}</button>
      </div>
    </form>
  )
}

function PatternsCard({ c, pats, open, setOpen, reload }: { c: ClientDoc; pats: Awaited<ReturnType<typeof api.patterns>> | null; open: boolean; setOpen: (v: boolean) => void; reload: () => void }) {
  const nameOf = useName()
  const { toast } = useContext(Ui)
  const list: Pattern[] = pats?.patterns || []
  const mining = pats?.job?.status === 'running'
  const mine = async () => { try { await api.patternsMine(c.speciality); reload() } catch (e: any) { toast(e.message) } }
  return (
    <div className="group">
      <div className="grouphead">
        <b>Patterns in {c.speciality || 'this speciality'}</b>
        <span className="caption">{mining ? pats?.job?.note : list.length ? `${list.length} patterns from the top ${pats?.reels} organic reels of the reference accounts · ${fmt.date(pats?.made_at)}` : `Found from your reference accounts' best reels (${pats?.available ?? '…'} analysed)`}</span>
        <span className="spacer" />
        {mining ? <span className="ic spinner" style={{ width: 16, height: 16, flexBasis: 16 }}><span style={{ width: 14, height: 14 }} /></span>
          : <button className="linkbtn" onClick={mine}>{list.length ? 'Find again' : 'Find patterns'}</button>}
        {list.length > 0 && <button className="linkbtn" style={{ marginLeft: 12 }} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button>}
      </div>
      {pats?.job?.status === 'failed' && <div className="err" style={{ margin: 12 }}>{pats.job.error}</div>}
      {!list.length && !mining && <div className="emptyrow">A plan finds these on its own the first time. You can also find them now; it takes a minute or two.</div>}
      {open && <div className="patgrid">{list.map(p => (
        <div key={p.id} className="patcard">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{p.name}</b><span style={{ fontWeight: 700, color: 'var(--c-green)', whiteSpace: 'nowrap' }}>{p.median_like_rate != null ? p.median_like_rate.toFixed(2) + '%' : ''}</span></div>
          <div className="caption" style={{ color: 'var(--c-sub)', lineHeight: 1.45 }}>{p.description}</div>
          <div className="caption" style={{ lineHeight: 1.45 }}><b style={{ color: 'var(--c-ink)', fontWeight: 600 }}>Structure:</b> {p.structure}</div>
          {p.example_hooks?.[0] && <div className="caption" style={{ fontStyle: 'italic', lineHeight: 1.45 }}>“{p.example_hooks[0]}”</div>}
          <div className="caption">{p.count} reels · {(p.accounts || []).map(a => nameOf(a)).join(', ')}{p.length_s ? ` · ~${p.length_s}s` : ''}</div>
        </div>
      ))}</div>}
    </div>
  )
}
