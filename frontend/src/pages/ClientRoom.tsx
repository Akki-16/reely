import { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { HoldButton, Toolbar, Ui, useName } from '../App'
import { api, clientImage, fmt, isTauri, langName, LANGS, lrColor, url } from '../api'
import type { Branch, Brief, ClientDoc, Person, Plan, Reel, Script, ScriptData, Source } from '../api'
import { label } from '../categoryInfo'
import { I } from '../icons'
import { Avatar, SCRIPT_LANGS } from './Clients'
import PlanTab from './PlanTab'
import { ExportSheet } from './Transfer'
import { ReviewShare, Teleprompter } from './ScriptTools'

const PEOPLE_COLORS = ['linear-gradient(180deg,#C4B5FD,#7C3AED)', 'linear-gradient(180deg,#7DD3FC,#0284C7)', 'linear-gradient(180deg,#86EFAC,#16A34A)', 'linear-gradient(180deg,#FDBA74,#EA580C)', 'linear-gradient(180deg,#F9A8D4,#DB2777)']
const BRANCH_COLORS = ['#D97706', '#0284C7', '#16A34A', '#DB2777', '#7C3AED', '#0D9488']
const ON_CAMERA: Record<string, string> = { confident: 'Confident on camera', camera: 'On camera', voiceover: 'Prefers voice-over', limited: 'Some topics only', off: 'Not on camera' }
const KIND_LABEL: Record<string, string> = { website: 'Website', social: 'Social account', listing: 'Listing', custom: 'Link', file: 'File', note: 'Note' }
type Ref = Reel & { added: string; note: string; scripts: number }

export default function ClientRoom() {
  const { id: idParam, tab: tabParam, sid } = useParams()
  const id = Number(idParam)
  const tab = tabParam || 'context'
  const nav = useNavigate()
  const { words, toast } = useContext(Ui)
  const [c, setC] = useState<ClientDoc | null>(null)
  const [err, setErr] = useState('')
  const [refs, setRefs] = useState<Ref[]>([])
  const [scripts, setScripts] = useState<Script[]>([])
  const [gen, setGen] = useState<{ ref: Ref | null } | null>(null)
  const [exporting, setExporting] = useState(false)

  const load = () => api.client(id).then(setC).catch(e => setErr(e.message))
  const loadRefs = () => api.clientRefs(id).then(setRefs).catch(() => {})
  const loadScripts = () => api.scripts(id).then(setScripts).catch(() => {})
  useEffect(() => { load(); loadRefs(); loadScripts() }, [id])
  const running = c?.job?.status === 'running'
  useEffect(() => {
    if (!running) return
    const t = setInterval(load, 2500); return () => clearInterval(t)
  }, [running, id])
  const writing = scripts.some(s => s.status === 'generating' || s.status === 'queued')
  useEffect(() => {
    if (!writing) return
    const t = setInterval(loadScripts, 4000); return () => clearInterval(t)
  }, [writing, id])

  const save = async (patch: Partial<ClientDoc>) => { try { setC(await api.clientEdit(id, patch)) } catch (e: any) { toast(e.message) } }
  const go = (t: string) => nav(`/clients/${id}/${t}`)
  const pickImage = async () => {
    let path: string | null = null
    if (isTauri) {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const r = await open({ multiple: false, directory: false, title: 'Choose an image: a logo or a photo', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'] }] })
      path = typeof r === 'string' ? r : null
    } else path = window.prompt('Path to the image')
    if (!path) return
    try { setC(await api.clientImage(id, path)) } catch (e: any) { toast(e.message) }
  }

  if (err) return <><Toolbar title={words.one} /><div className="main"><div className="main-inner"><div className="err">{err}</div><Link to="/clients">‹ {words.many}</Link></div></div></>
  if (!c) return <><Toolbar title={words.one} /><div className="main"><div className="empty">Loading…</div></div></>

  const meta = [c.speciality, c.city, c.branches.length > 1 ? `${c.branches.length} branches` : null, c.people.length ? `${c.people.length} ${c.people.length === 1 ? 'person' : 'people'}` : null, c.languages.map(l => LANGS[l] || l).join(', ') || null].filter(Boolean).join(' · ')
  const ctxTab = tab === 'brief' ? 'brief' : 'context'

  return (
    <>
      <Toolbar title={c.name}>
        <Link to="/clients" style={{ fontWeight: 600, marginRight: 'auto', order: -1 }}>‹ {words.many}</Link>
      </Toolbar>
      <div className="main"><div className="main-inner wide" style={{ maxWidth: 1240, gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="avatarbtn" onClick={pickImage} title={c.image ? 'Change the image' : 'Add an image'} aria-label="Change the client image"><Avatar name={c.name} color={c.color} size={48} src={clientImage(c)} /></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.025em' }}>{c.name}</div>
            <div className="sub">{meta || 'Add the speciality, people and branches below'}</div>
          </div>
          {c.brief && <button className="btn plain sm" onClick={async () => { try { const r = await api.briefPdf(id); toast(r.pdf ? `Saved ${r.path.split('/').pop()} to Downloads` : r.note || 'Saved') } catch (e: any) { toast(e.message) } }}>{I.pdf()} Share brief</button>}
          <ClientMenu c={c} onRename={name => save({ name })} onImage={pickImage} onNoImage={async () => { try { setC(await api.clientImageRemove(id)) } catch (e: any) { toast(e.message) } }} onExport={() => setExporting(true)} onDelete={async () => { await api.clientDelete(id); nav('/clients') }} />
        </div>
        <div className="roomtabs" role="tablist">
          <button role="tab" className={tab === 'context' || tab === 'brief' ? 'on' : ''} onClick={() => go(ctxTab)}>Context</button>
          <button role="tab" className={tab === 'refs' ? 'on' : ''} onClick={() => go('refs')}>References · {refs.length}</button>
          <button role="tab" className={tab === 'scripts' ? 'on' : ''} onClick={() => go('scripts')}>Scripts · {scripts.filter(s => s.status !== 'failed').length}{writing && <span className="pill amber" style={{ marginLeft: 8, padding: '1px 7px', fontSize: 10.5 }}>writing</span>}</button>
          <button role="tab" className={tab === 'plan' ? 'on' : ''} onClick={() => go('plan')}>Plan</button>
        </div>
        {(tab === 'context' || tab === 'brief') && (
          <div className="ctxbar">
            <div className="seg">
              <button className={tab === 'context' ? 'on' : ''} onClick={() => go('context')}>Sources · {c.sources.length + c.people.length + c.branches.length}</button>
              <button className={tab === 'brief' ? 'on' : ''} onClick={() => go('brief')}>Brief{c.brief ? '' : ' · not drafted'}</button>
            </div>
            <JobLine c={c} />
            <span className="spacer" />
            {tab === 'context' && <AddMenu c={c} save={save} reload={load} />}
            {tab === 'context' && <button className="btn sm" disabled={running || c.brief_meta.locked} title={c.brief_meta.locked ? 'The brief is locked' : ''} onClick={async () => { try { await api.briefDraft(id); load(); go('brief') } catch (e: any) { toast(e.message) } }}>{I.spark({ width: 13, height: 13 })} {c.brief ? 'Redraft brief' : 'Draft brief'}</button>}
          </div>
        )}
        {tab === 'context' && <Sources c={c} save={save} reload={load} />}
        {tab === 'brief' && <BriefView c={c} setC={setC} reload={load} />}
        {tab === 'refs' && <RefsView c={c} refs={refs} reload={loadRefs} onGenerate={r => setGen({ ref: r })} />}
        {tab === 'plan' && <PlanTab c={c} onScripts={loadScripts} />}
        {tab === 'scripts' && <ScriptsView c={c} scripts={scripts} sid={sid ? Number(sid) : null} reload={loadScripts} onNew={() => setGen({ ref: null })} />}
      </div></div>
      {exporting && <ExportSheet client={c.id} onClose={() => setExporting(false)} />}
      {gen && <GenerateSheet c={c} refReel={gen.ref} onClose={() => setGen(null)} onMade={async sid => { setGen(null); await loadScripts(); loadRefs(); nav(`/clients/${id}/scripts/${sid}`) }} />}
    </>
  )
}

function JobLine({ c }: { c: ClientDoc }) {
  const j = c.job
  if (!j) return null
  if (j.status === 'running') return <span className="caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="ic spinner" style={{ width: 14, height: 14, flexBasis: 14 }}><span style={{ width: 12, height: 12, borderWidth: 1.5 }} /></span>{j.note || 'Working…'}</span>
  if (j.status === 'failed') return <span className="caption" style={{ color: 'var(--c-red)' }}>{j.error}</span>
  return null
}

function ClientMenu({ c, onRename, onExport, onDelete, onImage, onNoImage }: { c: ClientDoc; onRename: (n: string) => void; onExport: () => void; onDelete: () => void; onImage: () => void; onNoImage: () => void }) {
  const { words, ask } = useContext(Ui)
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className={'btn plain sm' + (open ? ' on' : '')} onClick={() => setOpen(v => !v)} aria-label="More">•••</button>
      {open && <div className="card menu" style={{ width: 240 }}>
        <button className="row" onClick={async () => { setOpen(false); const n = await ask({ title: `Rename ${words.one.toLowerCase()}`, label: 'Name', value: c.name, ok: 'Rename' }); if (n && n !== c.name) onRename(n) }}>Rename…</button>
        <button className="row" onClick={() => { setOpen(false); onImage() }}>{c.image ? 'Change image…' : 'Add an image…'}</button>
        {c.image && <button className="row" onClick={() => { setOpen(false); onNoImage() }}>Remove image</button>}
        <button className="row" onClick={() => { setOpen(false); onExport() }}>Export this {words.one.toLowerCase()}…</button>
        <div style={{ borderTop: '1px solid var(--c-hair)', margin: '4px 0' }} />
        <HoldButton label={`Delete ${words.one.toLowerCase()}`} ms={2500} onHold={onDelete} className="row" style={{ width: '100%', justifyContent: 'flex-start' }} />
        <div className="caption" style={{ padding: '2px 8px 6px' }}>Removes its brief, references and scripts. The reels themselves stay.</div>
      </div>}
    </div>
  )
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])
  return ref
}

const uid = (p: string) => p + Math.random().toString(16).slice(2, 10)

async function pickFiles(): Promise<string[]> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const r = await open({ multiple: true, directory: false, title: 'Add files: PDFs, images or documents', filters: [{ name: 'Documents and images', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md', 'csv', 'docx'] }] })
    return Array.isArray(r) ? r : typeof r === 'string' ? [r] : []
  }
  const p = window.prompt('Path to the file')
  return p ? [p] : []
}

type Edit = { kind: 'person'; item: Person } | { kind: 'branch'; item: Branch } | { kind: 'source'; item: Source }

function AddMenu({ c, save, reload }: { c: ClientDoc; save: (p: Partial<ClientDoc>) => Promise<void>; reload: () => void }) {
  const { toast } = useContext(Ui)
  const [open, setOpen] = useState(false)
  const [edit, setEdit] = useState<Edit | null>(null)
  const ref = useOutside(open, () => setOpen(false))
  const item = (icon: string, title: string, sub: string, fn: () => void) => <button className="row" style={{ justifyContent: 'flex-start', gap: 10 }} onClick={() => { setOpen(false); fn() }}><span style={{ width: 22, textAlign: 'center' }}>{icon}</span><span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}><b style={{ fontWeight: 600 }}>{title}</b><span className="caption">{sub}</span></span></button>
  const src = (kind: Source['kind'], label: string) => setEdit({ kind: 'source', item: { id: '', kind, label, value: '' } })
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className={'btn sm' + (open ? ' on' : '')} style={{ background: 'var(--c-ink)', color: 'var(--c-bg)' }} onClick={() => setOpen(v => !v)}>{I.plus()} Add {I.down({ width: 10, height: 10 })}</button>
      {open && <div className="card menu" style={{ width: 270 }}>
        {item('👤', 'Person', 'doctor, founder, staff, actor', () => setEdit({ kind: 'person', item: { id: '', name: '', lead: !c.people.some(p => p.lead), on_camera: 'confident', languages: [] } }))}
        {item('📍', 'Branch', 'a location with its Maps listing', () => setEdit({ kind: 'branch', item: { id: '', name: '', main: !c.branches.length } }))}
        {item('🌐', 'Website', "the hospital's or a doctor's", () => src('website', c.sources.some(s => s.kind === 'website') ? '' : 'Hospital website'))}
        {item('◎', 'Social account', 'Instagram, YouTube, Facebook', () => src('social', 'Instagram'))}
        {item('★', 'Listing', 'Practo, Justdial, Google', () => src('listing', 'Practo'))}
        {item('📄', 'Files', 'PDFs, images, documents', async () => { const paths = await pickFiles(); if (paths.length) { try { await api.clientFiles(c.id, paths); reload() } catch (e: any) { toast(e.message) } } })}
        {item('✎', 'Note', 'front-desk questions, anything typed', () => src('note', 'Front-desk questions'))}
        <div style={{ borderTop: '1px solid var(--c-hair)', margin: '4px 0' }} />
        <button className="row" style={{ color: 'var(--c-tint)', fontWeight: 600, justifyContent: 'flex-start', gap: 10 }} onClick={() => { setOpen(false); src('custom', '') }}><span style={{ width: 22, textAlign: 'center' }}>+</span>Custom field…</button>
      </div>}
      {edit && <EditSheet c={c} edit={edit} onClose={() => setEdit(null)} save={save} />}
    </div>
  )
}

function Sources({ c, save, reload }: { c: ClientDoc; save: (p: Partial<ClientDoc>) => Promise<void>; reload: () => void }) {
  const { toast } = useContext(Ui)
  const [edit, setEdit] = useState<Edit | null>(null)
  const links = c.sources.filter(s => !['file', 'note'].includes(s.kind))
  const docs = c.sources.filter(s => ['file', 'note'].includes(s.kind))
  const owner = (s: Source) => c.people.find(p => p.id === s.person_id)?.name || c.branches.find(b => b.id === s.branch_id)?.name
  const scripts = (p: Person) => p.lead ? '★ Lead face' : ''
  const statusColor = (s: Source) => s.status === 'ok' ? 'var(--c-green)' : s.status === 'warn' || s.status === 'todo' ? 'var(--c-amber)' : 'var(--c-muted)'
  const unread = links.filter(s => !s.read_at).length
  return (
    <div className="sources">
      <div className="srccol">
        <div className="group">
          <div className="grouphead"><b>People</b><span className="caption">who appears, and whose voice the scripts are in</span><span className="spacer" /><button className="linkbtn" onClick={() => setEdit({ kind: 'person', item: { id: '', name: '', lead: !c.people.some(p => p.lead), on_camera: 'confident', languages: [] } })}>+ Person</button></div>
          {c.people.length === 0 && <div className="emptyrow">Add the doctor the scripts are for, then anyone else who appears. Mark one as the lead face.</div>}
          {c.people.map((p, i) => (
            <button key={p.id} className={'srcrow person' + (p.lead ? ' lead' : '')} onClick={() => setEdit({ kind: 'person', item: p })}>
              <Avatar name={p.name} color={PEOPLE_COLORS[i % PEOPLE_COLORS.length]} size={38} round />
              <span className="fill">
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><b style={{ fontSize: 13.5 }}>{p.name || 'Unnamed'}</b>{p.lead && <span className="leadbadge">{scripts(p)}</span>}</span>
                <span className="caption" style={{ color: 'var(--c-sub)' }}>{[p.role, c.branches.filter(b => p.branches?.includes(b.id)).map(b => b.name).join(', ')].filter(Boolean).join(' · ') || 'Add a role'}</span>
                <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 3 }}>
                  {(p.languages || []).map(l => <span key={l} className="tag">{l}</span>)}
                  {p.on_camera && <span className={'tag ' + (p.on_camera === 'confident' || p.on_camera === 'camera' ? 'green' : p.on_camera === 'off' ? '' : 'amber')}>{ON_CAMERA[p.on_camera] || p.on_camera}</span>}
                  {c.sources.filter(s => s.person_id === p.id).map(s => <span key={s.id} className="tag tint">{s.label}</span>)}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="group">
          <div className="grouphead"><b>Branches</b><span className="caption">each has its own reviews and call to action</span><span className="spacer" /><button className="linkbtn" onClick={() => setEdit({ kind: 'branch', item: { id: '', name: '', main: !c.branches.length } })}>+ Branch</button></div>
          {c.branches.length === 0 && <div className="emptyrow">Add each location. Reels for one branch end with that branch's number.</div>}
          {c.branches.map((b, i) => (
            <button key={b.id} className="srcrow" onClick={() => setEdit({ kind: 'branch', item: b })}>
              <span style={{ color: BRANCH_COLORS[i % BRANCH_COLORS.length], fontSize: 15, width: 18 }}>●</span>
              <span className="fill"><span><b>{b.name}</b>{b.main && <span className="caption"> · main</span>}</span>
                <span className="caption" style={{ color: 'var(--c-sub)' }}>{[b.area, b.services, b.cta].filter(Boolean).join(' · ') || 'Add services and the call to action'}</span></span>
              <span className="caption" style={{ color: b.reviews ? 'var(--c-green)' : undefined, fontWeight: b.reviews ? 600 : 400 }}>{b.reviews ? 'reviews pasted' : b.maps ? 'Maps link' : ''}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="srccol">
        <div className="group">
          <div className="grouphead"><b>Links</b><span className="caption">name each one; tie it to a person or branch</span><span className="spacer" />{unread > 0 && <button className="linkbtn" onClick={async () => { try { await api.clientRead(c.id); reload() } catch (e: any) { toast(e.message) } }}>Read {unread} now</button>}</div>
          {links.length === 0 && <div className="emptyrow">Add the hospital website, each doctor's own site and Instagram, and listings such as Practo.</div>}
          {links.map(s => (
            <button key={s.id} className="srcrow link" onClick={() => setEdit({ kind: 'source', item: s })}>
              <b className="lbl">{s.label || KIND_LABEL[s.kind]}</b>
              <span className="val">{s.value}{owner(s) && <span className="caption"> · {owner(s)}</span>}</span>
              <span className="st" style={{ color: statusColor(s) }}>{s.detail || (s.read_at ? '' : 'not read yet')}</span>
            </button>
          ))}
        </div>
        <div className="group">
          <div className="grouphead"><b>Files and notes</b><span className="spacer" /><button className="linkbtn" onClick={async () => { const paths = await pickFiles(); if (paths.length) { try { await api.clientFiles(c.id, paths); reload() } catch (e: any) { toast(e.message) } } }}>+ Files</button><button className="linkbtn" style={{ marginLeft: 12 }} onClick={() => setEdit({ kind: 'source', item: { id: '', kind: 'note', label: '', value: '' } })}>+ Note</button></div>
          {docs.length === 0 && <div className="emptyrow">Brochures, doctor profiles, a marketing plan, or questions patients ask at the front desk. Claude reads PDFs and images.</div>}
          {docs.map(s => (
            <button key={s.id} className="srcrow link" onClick={() => setEdit({ kind: 'source', item: s })}>
              <b className="lbl">{s.label}</b>
              <span className="val" style={{ color: 'var(--c-sub)' }}>{s.kind === 'note' ? s.value.split('\n')[0] : s.value}{owner(s) && <span className="caption"> · {owner(s)}</span>}</span>
              <span className="st caption">{s.kind === 'file' ? `${s.detail || 'file'} · ${fmt.bytes(s.size || 0)}` : `note · ${s.value.split('\n').filter(Boolean).length} lines`}</span>
            </button>
          ))}
        </div>
      </div>
      {edit && <EditSheet c={c} edit={edit} onClose={() => setEdit(null)} save={save} />}
    </div>
  )
}

const igHandle = (v: string) => { const m = (v || '').match(/instagram\.com\/([A-Za-z0-9_.]+)/); const h = (m ? m[1] : (v || '').trim().replace(/^@/, '')).replace(/\/$/, ''); return /^[A-Za-z0-9_.]{1,40}$/.test(h) && !['p', 'reel', 'reels', 'explore'].includes(h) ? h : null }

function EditSheet({ c, edit, onClose, save }: { c: ClientDoc; edit: Edit; onClose: () => void; save: (p: Partial<ClientDoc>) => Promise<void> }) {
  const { clinics, viewOnly, toast, refreshClinics } = useContext(Ui)
  const isNew = !edit.item.id
  const [v, setV] = useState<any>({ ...edit.item })
  const set = (k: string, val: any) => setV((x: any) => ({ ...x, [k]: val }))
  const [scraping, setScraping] = useState(false)
  const commit = async () => { await commitOnly(); onClose() }
  const commitOnly = async () => {
    const item = { ...v, id: v.id || uid(edit.kind[0]) }
    if (edit.kind === 'person') {
      let people = isNew ? [...c.people, item] : c.people.map(p => p.id === item.id ? item : p)
      if (item.lead) people = people.map(p => ({ ...p, lead: p.id === item.id }))
      await save({ people })
    } else if (edit.kind === 'branch') {
      let branches = isNew ? [...c.branches, item] : c.branches.map(b => b.id === item.id ? item : b)
      if (item.main) branches = branches.map(b => ({ ...b, main: b.id === item.id }))
      await save({ branches })
    } else {
      await save({ sources: isNew ? [...c.sources, item] : c.sources.map(s => s.id === item.id ? item : s) })
    }
  }
  const remove = async () => {
    if (edit.kind === 'person') await save({ people: c.people.filter(p => p.id !== v.id), sources: c.sources.map(s => s.person_id === v.id ? { ...s, person_id: null } : s) })
    else if (edit.kind === 'branch') await save({ branches: c.branches.filter(b => b.id !== v.id), people: c.people.map(p => ({ ...p, branches: (p.branches || []).filter(x => x !== v.id) })) })
    else await save({ sources: c.sources.filter(s => s.id !== v.id) })
    onClose()
  }
  const title = edit.kind === 'person' ? (isNew ? 'Add a person' : v.name) : edit.kind === 'branch' ? (isNew ? 'Add a branch' : v.name) : (isNew ? `Add ${KIND_LABEL[v.kind].toLowerCase()}` : v.label)
  const valid = edit.kind === 'source' ? (v.kind === 'file' || (v.value || '').trim()) && (v.label || '').trim() : (v.name || '').trim()
  const owners = <label className="formrow"><span>Belongs to</span><div className="field"><select value={v.person_id ? 'p:' + v.person_id : v.branch_id ? 'b:' + v.branch_id : ''} onChange={e => { const x = e.target.value; set('person_id', x.startsWith('p:') ? x.slice(2) : null); set('branch_id', x.startsWith('b:') ? x.slice(2) : null) }}>
    <option value="">The whole {`hospital`}</option>
    {c.people.map(p => <option key={p.id} value={'p:' + p.id}>{p.name}</option>)}
    {c.branches.map(b => <option key={b.id} value={'b:' + b.id}>{b.name} branch</option>)}
  </select></div></label>
  return createPortal(
    <div className="sheet-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="card sheet" style={{ width: 520 }} onSubmit={e => { e.preventDefault(); if (valid) commit() }}>
        <b style={{ fontSize: 17 }}>{title || 'Edit'}</b>
        {edit.kind === 'person' && <>
          <div className="grid2" style={{ gap: 12 }}>
            <label className="formrow"><span>Name</span><div className="field"><input autoFocus value={v.name || ''} onChange={e => set('name', e.target.value)} placeholder="Dr. …" /></div></label>
            <label className="formrow"><span>Role</span><div className="field"><input value={v.role || ''} onChange={e => set('role', e.target.value)} placeholder="Fertility specialist, founder" /></div></label>
          </div>
          <label className="formrow"><span>Languages they speak on camera</span><div className="field"><input value={(v.languages || []).join(', ')} onChange={e => set('languages', e.target.value.split(',').map((x: string) => x.trim()).filter(Boolean))} placeholder="Telugu, English" /></div></label>
          <div className="formrow"><span>On camera</span><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{Object.entries(ON_CAMERA).map(([k, l]) => <button type="button" key={k} className={'chipbtn' + (v.on_camera === k ? ' on' : '')} onClick={() => set('on_camera', k)}>{l}</button>)}</div></div>
          {c.branches.length > 0 && <div className="formrow"><span>Branches</span><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{c.branches.map(b => <button type="button" key={b.id} className={'chipbtn' + ((v.branches || []).includes(b.id) ? ' on' : '')} onClick={() => set('branches', (v.branches || []).includes(b.id) ? v.branches.filter((x: string) => x !== b.id) : [...(v.branches || []), b.id])}>{b.name}</button>)}</div></div>}
          <label className="formrow"><span>Notes for script writing</span><textarea className="inline" rows={3} value={v.note || ''} onChange={e => set('note', e.target.value)} placeholder="Topics they own, how they like to come across, anything to avoid" /></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}><button type="button" className={'toggle' + (v.lead ? ' on' : '')} onClick={() => set('lead', !v.lead)} aria-pressed={!!v.lead} /><span><b>Lead face</b><div className="caption">Scripts are written in this person's voice unless you choose someone else.</div></span></label>
        </>}
        {edit.kind === 'branch' && <>
          <div className="grid2" style={{ gap: 12 }}>
            <label className="formrow"><span>Name</span><div className="field"><input autoFocus value={v.name || ''} onChange={e => set('name', e.target.value)} placeholder="Banjara Hills" /></div></label>
            <label className="formrow"><span>Area or city</span><div className="field"><input value={v.area || ''} onChange={e => set('area', e.target.value)} placeholder="Hyderabad" /></div></label>
          </div>
          <label className="formrow"><span>Services at this branch</span><div className="field"><input value={v.services || ''} onChange={e => set('services', e.target.value)} placeholder="All services, or IUI and consultations" /></div></label>
          <label className="formrow"><span>Call to action</span><div className="field"><input value={v.cta || ''} onChange={e => set('cta', e.target.value)} placeholder="WhatsApp 98… to book" /></div></label>
          <label className="formrow"><span>Google Maps link</span><div className="field"><input value={v.maps || ''} onChange={e => set('maps', e.target.value)} placeholder="https://maps.app.goo.gl/…" /></div></label>
          <label className="formrow"><span>Reviews <span className="caption">Maps can't be read automatically; paste a few reviews here</span></span><textarea className="inline" rows={4} value={v.reviews || ''} onChange={e => set('reviews', e.target.value)} /></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}><button type="button" className={'toggle' + (v.main ? ' on' : '')} onClick={() => set('main', !v.main)} aria-pressed={!!v.main} /><b>Main branch</b></label>
        </>}
        {edit.kind === 'source' && <>
          <label className="formrow"><span>Label</span><div className="field"><input autoFocus={!isNew || v.kind === 'custom' || !v.label} value={v.label || ''} onChange={e => set('label', e.target.value)} placeholder={v.kind === 'website' ? "Hospital website, Dr. Neha's website" : v.kind === 'note' ? 'Front-desk questions' : 'What is this?'} /></div></label>
          {v.kind === 'note' || (v.kind === 'custom' && !/^https?:|^www\./.test(v.value || '') && (v.value || '').includes('\n'))
            ? <label className="formrow"><span>Text</span><textarea className="inline" rows={8} autoFocus={isNew && !!v.label} value={v.value || ''} onChange={e => set('value', e.target.value)} placeholder="One question or fact per line" /></label>
            : v.kind === 'file' ? <div className="caption">File: {v.value}</div>
            : <label className="formrow"><span>{v.kind === 'custom' ? 'Link or text' : 'Link'}</span><div className="field"><input autoFocus={isNew && !!v.label} value={v.value || ''} onChange={e => set('value', e.target.value)} placeholder={v.kind === 'social' ? '@handle or https://instagram.com/…' : 'https://…'} /></div></label>}
          {owners}
          {v.detail && <div className="caption" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{v.detail}{v.read_at && v.kind !== 'note' && v.kind !== 'file' && <button type="button" className="linkbtn" onClick={async () => { await api.clientRead(c.id, v.id).catch(() => {}); await save({}); onClose() }}>Read again</button>}</div>}
          {v.kind === 'social' && (() => {
            const ig = /instagram|^@/.test(v.value || '') || !/[/.]/.test(v.value || '') ? igHandle(v.value || '') : null
            const known = ig ? clinics.find(x => x.handle === ig) : null
            if (!ig) return <div className="caption">Paste an Instagram link or @handle. Reely can scrape it so its reels and like-rate feed the brief.</div>
            if (known) return <div className="notebox" style={{ gap: 4 }}><b style={{ fontSize: 13 }}>@{ig} is in Reely</b><span className="caption">{(known.reels_total || 0).toLocaleString()} reels · {known.analysed} analysed{known.median_like_rate != null ? ` · median like-rate ${known.median_like_rate.toFixed(2)}%` : ''}{['running', 'queued'].includes(known.status) ? ' · run in progress' : ''}. {known.analysed ? 'The brief reads its best reels.' : 'The brief reads it once its run finishes.'}</span></div>
            return (
              <div className="notebox" style={{ gap: 8 }}>
                <span className="sub" style={{ lineHeight: 1.5 }}><b>@{ig} isn't in Reely yet.</b> Scrape it and the brief gets this client's own reels: what they post and their like-rate today.</span>
                {viewOnly ? <span className="caption">Scraping runs on an Apple Silicon Mac.</span> : <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="button" className="btn sm" disabled={scraping} onClick={async () => {
                    setScraping(true)
                    try { if (valid) await commitOnly(); await api.addClinic(ig, 'Client accounts'); refreshClinics(); toast(`Scraping @${ig}. Follow it on the Run page; the brief reads it when it finishes.`); onClose() }
                    catch (e: any) { toast(e.message); setScraping(false) }
                  }}>{scraping ? 'Starting…' : 'Scrape this account'}</button>
                  <span className="caption" style={{ flex: 1, minWidth: 180 }}>It goes under its own speciality, Client accounts, so it stays out of your research numbers.</span>
                </div>}
              </div>
            )
          })()}
        </>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!isNew && <HoldButton label="Remove" ms={1200} onHold={remove} className="btn plain" />}
          <span className="spacer" />
          <button type="button" className="btn plain" onClick={onClose}>Cancel</button>
          <button className="btn" type="submit" disabled={!valid}>{isNew ? 'Add' : 'Save'}</button>
        </div>
      </form>
    </div>, document.body
  )
}

/* ---------------- Brief ---------------- */
const SECTION_ORDER: [string, string][] = [['people', 'The people'], ['services', "What we're pushing"], ['branches', 'Where'], ['audience', "Who we're talking to"], ['questions', 'What they ask'], ['voice', 'Voice'], ['say_never', 'Say · never say'], ['posted', 'Already posted'], ['cta', 'Every reel ends with']]
const asText = (x: any) => typeof x === 'string' ? x : x?.text ?? x?.q ?? ''
const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean)
const keepSrc = (old: any[] = [], next: string[], key: 'text' | 'q') => next.map(t => { const o = old.find(x => asText(x) === t); return o && typeof o === 'object' ? o : { [key]: t } })

function BriefView({ c, setC, reload }: { c: ClientDoc; setC: (c: ClientDoc) => void; reload: () => void }) {
  const { toast, ask } = useContext(Ui)
  const b = c.brief
  const m = c.brief_meta || {}
  const busy = c.job?.status === 'running'
  const [editing, setEditing] = useState<string | null>(null)
  const saveBrief = async (patch: Brief, section: string) => { try { setC(await api.briefSave(c.id, { brief: { ...b, ...patch }, section })); setEditing(null) } catch (e: any) { toast(e.message) } }
  const redraft = async (section: string) => {
    const note = await ask({ title: 'Redraft with Claude', label: 'Anything Claude should change?', placeholder: 'Optional, e.g. shorter, or mention the Kondapur branch', multiline: true, optional: true, ok: 'Redraft', note: 'Claude rewrites only this section from the sources.' })
    if (note === null) return
    try { await api.briefRedraft(c.id, section, note); setEditing(null); reload() } catch (e: any) { toast(e.message) }
  }
  const lock = async (locked: boolean) => { try { setC(await api.briefSave(c.id, { locked })) } catch (e: any) { toast(e.message) } }
  // "On this page" follows the section you are reading, and a jump flashes where you landed
  const [active, setActive] = useState('')
  useEffect(() => {
    if (!b) return
    const els = SECTION_ORDER.map(([k]) => document.getElementById('b-' + k)).filter(Boolean) as HTMLElement[]
    const seen = new Map<string, number>()
    const io = new IntersectionObserver(es => {
      es.forEach(e => seen.set(e.target.id.slice(2), e.isIntersecting ? e.intersectionRatio : 0))
      const best = SECTION_ORDER.map(([k]) => k).find(k => (seen.get(k) || 0) > 0)
      if (best) setActive(best)
    }, { rootMargin: '-12% 0px -55% 0px', threshold: [0, .2, .6] })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [!!b, b?.posted])
  const jump = (k: string) => {
    const el = document.getElementById('b-' + k); if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setActive(k)
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash')
  }
  // things to check: tick one off, or answer it. Answers go into a note the next redraft reads.
  const [allChecks, setAllChecks] = useState(false)
  const dropCheck = async (i: number) => { try { setC(await api.briefSave(c.id, { brief: { ...b, checks: (b!.checks || []).filter((_: string, j: number) => j !== i) }, section: 'checks' })) } catch (e: any) { toast(e.message) } }
  const answerCheck = async (i: number) => {
    const q: string = b!.checks[i]
    const a = await ask({ title: 'Answer this', label: q, multiline: true, placeholder: 'What is the right answer?', ok: 'Save answer', note: 'Saved to a note called Confirmed facts in Sources. Redraft the brief, or just that section, to use it.' })
    if (!a) return
    try {
      const line = `• ${q}\n  → ${a}`
      const has = c.sources.find(x => x.id === 'sconfirmed')
      const sources = has ? c.sources.map(x => x.id === 'sconfirmed' ? { ...x, value: (x.value ? x.value + '\n' : '') + line } : x)
        : [...c.sources, { id: 'sconfirmed', kind: 'note' as const, label: 'Confirmed facts', value: line }]
      await api.clientEdit(c.id, { sources })
      setC(await api.briefSave(c.id, { brief: { ...b, checks: (b!.checks || []).filter((_: string, j: number) => j !== i) }, section: 'checks' }))
      toast('Answer saved to Confirmed facts')
    } catch (e: any) { toast(e.message) }
  }

  if (!b) return (
    <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start', maxWidth: 680 }}>
      <b style={{ fontSize: 16 }}>No brief yet</b>
      <div className="sub" style={{ lineHeight: 1.55 }}>Claude reads every source (websites, Instagram, files, notes and pasted reviews) and writes a one-page brief: positioning, people, services, branches, patients and their questions, voice, what to never say, and the call to action. Every script is written from it, and you can edit any part.</div>
      {busy ? <JobLine c={c} /> : <button className="btn" disabled={!c.sources.length && !c.people.length} onClick={async () => { try { await api.briefDraft(c.id); reload() } catch (e: any) { toast(e.message) } }}>{I.spark({ width: 13, height: 13 })} Draft the brief</button>}
      {!c.sources.length && !c.people.length && <div className="caption">Add a person, a website, a file or a note first.</div>}
      {c.job?.status === 'failed' && <div className="err">{c.job.error}</div>}
    </div>
  )

  const locked = !!m.locked
  const people = (b.people || []) as { id: string; summary: string }[]
  const voice = b.voice || {}
  const cta = typeof b.cta === 'object' && b.cta ? b.cta : { text: asText(b.cta) }
  const sec = (key: string, title: string, view: React.ReactNode, editor: (done: (patch: Brief) => void) => React.ReactNode, cls = '') => {
    const isEditing = editing === key
    const working = busy && c.job?.kind === 'section' && c.job?.section === key
    return (
      <section key={key} className={'bsec ' + cls + (isEditing ? ' editing' : '') + (locked ? ' locked' : '')} id={'b-' + key}>
        {!locked && !isEditing && <div className="bsec-tools">
          <button onClick={() => setEditing(key)}>{I.pencil()} Edit</button>
          <button onClick={() => redraft(key)} disabled={busy}>{I.spark({ width: 12, height: 12 })} Redraft with Claude</button>
        </div>}
        {title && <div className="beyebrow">{title}{(m.edited || []).includes(key) && <span className="editdot" title="Edited by you">●</span>}{working && <span className="caption" style={{ marginLeft: 8, letterSpacing: 0, textTransform: 'none', fontWeight: 500 }}>redrafting…</span>}</div>}
        {isEditing ? editor(p => saveBrief(p, key)) : view}
      </section>
    )
  }

  return (
    <div className="briefwrap">
      <article className="briefdoc">
        <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="beyebrow" style={{ display: 'flex' }}>Client brief<span style={{ color: 'var(--c-muted)', margin: '0 8px' }}>·</span><span style={{ color: 'var(--c-muted)' }}>{c.speciality}</span><span className="spacer" /><span style={{ color: 'var(--c-muted)', letterSpacing: 0, textTransform: 'none', fontWeight: 600 }}>Version {m.version || 1}{m.drafted_at ? ' · ' + fmt.date(m.drafted_at) : ''}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}><Avatar name={c.name} color={c.color} size={52} src={clientImage(c)} /><h1 style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: '-.03em' }}>{c.name}</h1></div>
          {sec('positioning', '', <p className="lede">{b.positioning || <span className="caption">Add a one-line positioning</span>}</p>,
            done => <TextEdit value={b.positioning || ''} rows={2} onSave={t => done({ positioning: t })} onCancel={() => setEditing(null)} />)}
        </header>
        <div className="bstats">
          <div><b>{c.branches.length || 1}</b><span>{c.branches.length > 1 ? 'branches' : 'location'}{c.city ? ', ' + c.city : ''}</span></div>
          <div><b>{c.people.filter(p => p.on_camera && p.on_camera !== 'off').length}</b><span>people on camera</span></div>
          <div><b>{(voice.mix || []).map((x: any) => (LANGS[x.lang] || x.lang).slice(0, 2)).join(' · ') || '—'}</b><span>{(voice.mix || []).map((x: any) => x.pct).join(' / ')} language mix</span></div>
          <div><b>{m.sources ?? '—'}</b><span>sources read</span></div>
        </div>
        {sec('people', 'The people', <div className="bpeople">{people.map(x => { const p = c.people.find(q => q.id === x.id); const i = c.people.findIndex(q => q.id === x.id); return (
            <div key={x.id} className={'bperson' + (p?.lead ? ' lead' : '')}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Avatar name={p?.name || '?'} color={PEOPLE_COLORS[(i < 0 ? 0 : i) % PEOPLE_COLORS.length]} size={40} round /><div><b style={{ fontSize: 14 }}>{p?.name || x.id}</b><div style={{ fontSize: 11, fontWeight: 700, color: p?.lead ? 'var(--c-tint)' : 'var(--c-muted)' }}>{p?.lead ? '★ LEAD FACE' : p?.role}</div></div></div>
              <div className="bsmall">{x.summary}</div>
            </div>) })}</div>,
          done => <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{people.length === 0 && <div className="caption">Add people on the Sources side, then redraft this section.</div>}<MultiEdit items={people.map(x => ({ label: c.people.find(p => p.id === x.id)?.name || x.id, value: x.summary }))} onSave={vals => done({ people: people.map((x, i) => ({ ...x, summary: vals[i] })) })} onCancel={() => setEditing(null)} /></div>)}
        <div className="btwo">
          {sec('services', "What we're pushing", <ol className="blist num">{(b.services || []).map((x: any, i: number) => <li key={i}>{asText(x)}{x?.src && <Src s={x.src} />}</li>)}</ol>,
            done => <TextEdit value={(b.services || []).map(asText).join('\n')} rows={6} hint="One per line, most important first" onSave={t => done({ services: keepSrc(b.services, lines(t), 'text') })} onCancel={() => setEditing(null)} />)}
          {sec('branches', 'Where', <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{(b.branches || []).map((x: any, i: number) => <div key={i} style={{ display: 'flex', gap: 10 }}><span style={{ color: BRANCH_COLORS[i % BRANCH_COLORS.length], fontSize: 15, lineHeight: 1.2 }}>●</span><div><b style={{ fontSize: 14 }}>{x.name}</b><div className="bsmall">{x.note}{x.src && <Src s={x.src} />}</div></div></div>)}</div>,
            done => <MultiEdit items={(b.branches || []).map((x: any) => ({ label: x.name, value: x.note }))} onSave={vals => done({ branches: (b.branches || []).map((x: any, i: number) => ({ ...x, note: vals[i] })) })} onCancel={() => setEditing(null)} />)}
        </div>
        {sec('audience', "Who we're talking to", <p className="bpara">{asText(b.audience)}</p>,
          done => <TextEdit value={asText(b.audience)} rows={5} onSave={t => done({ audience: { ...(typeof b.audience === 'object' ? b.audience : {}), text: t } })} onCancel={() => setEditing(null)} />)}
        {sec('questions', 'What they ask', <div className="bquestions">{(b.questions || []).map((x: any, i: number) => <div key={i} className="bq"><span className="bquote">“</span><span style={{ flex: 1 }}>{asText(x)}</span>{x?.src && <span className="caption">{x.src}</span>}</div>)}</div>,
          done => <TextEdit value={(b.questions || []).map(asText).join('\n')} rows={7} hint="One question per line, in the patient's words" onSave={t => done({ questions: keepSrc(b.questions, lines(t), 'q') })} onCancel={() => setEditing(null)} />)}
        <div className="btwo">
          {sec('voice', 'Voice', <div className="bvoice">
              {[['clinical', 'Warm', 'Clinical'], ['technical', 'Simple', 'Technical'], ['energy', 'Calm', 'Energetic']].map(([k, a, z]) => <div key={k}><div className="ends"><span>{a}</span><span>{z}</span></div><div className="track"><span style={{ left: `calc(${Math.max(0, Math.min(100, Number(voice[k]) || 0))}% - 7px)` }} /></div></div>)}
              {(voice.mix || []).length > 0 && <div><div className="ends">{(voice.mix || []).map((x: any) => <span key={x.lang}>{LANGS[x.lang] || x.lang} {x.pct}%</span>)}</div><div className="mixbar">{(voice.mix || []).map((x: any, i: number) => <span key={x.lang} style={{ width: x.pct + '%', opacity: 1 - i * .45 }} />)}</div></div>}
              {voice.note && <div className="caption" style={{ color: 'var(--c-sub)' }}>{voice.note}</div>}
            </div>,
            done => <VoiceEdit voice={voice} onSave={v => done({ voice: v })} onCancel={() => setEditing(null)} />)}
          {sec('say_never', 'Say · never say', <div className="bsay">{(b.say || []).map((x: string, i: number) => <div key={'s' + i}><span className="ok">✓</span>{x}</div>)}{(b.never || []).map((x: string, i: number) => <div key={'n' + i}><span className="no">✕</span>{x}</div>)}</div>,
            done => <SayEdit say={b.say || []} never={b.never || []} onSave={(say, never) => done({ say, never })} onCancel={() => setEditing(null)} />)}
        </div>
        {(b.posted || editing === 'posted') && sec('posted', 'Already posted', <p className="bpara">{b.posted}</p>, done => <TextEdit value={b.posted || ''} rows={3} onSave={t => done({ posted: t })} onCancel={() => setEditing(null)} />)}
        {(b.extra || []).map((x: any, i: number) => sec('extra-' + i, x.title, <p className="bpara" style={{ whiteSpace: 'pre-wrap' }}>{x.body}</p>,
          done => <ExtraEdit title={x.title} body={x.body} onSave={(title, body) => done({ extra: (b.extra || []).map((y: any, j: number) => j === i ? { title, body } : y).filter((y: any) => y.title || y.body) })} onCancel={() => setEditing(null)} />))}
        {sec('cta', '', <div className="bcta"><div className="beyebrow" style={{ color: '#C4B5FD', width: 96 }}>Every reel ends with</div><div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 600 }}>{cta.text}</div>{cta.note && <div style={{ fontSize: 12.5, opacity: .65 }}>{cta.note}</div>}</div></div>,
          done => <MultiEdit items={[{ label: 'Every reel ends with', value: cta.text || '' }, { label: 'Branch or person variations', value: cta.note || '' }]} onSave={([text, note]) => done({ cta: { text, note } })} onCancel={() => setEditing(null)} />)}
        {!locked && <button className="baddsec" onClick={async () => { const t = await ask({ title: 'Add a section', label: 'Section title', placeholder: 'e.g. Competitors, Festivals, Doctor availability', ok: 'Add' }); if (t) { await saveBrief({ extra: [...(b.extra || []), { title: t, body: '' }] }, 'extra'); setEditing('extra-' + (b.extra || []).length) } }}>{I.plus()} Add a section</button>}
      </article>
      <aside className="briefrail">
        <div className="card railcard">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><button className={'toggle' + (locked ? ' on' : '')} onClick={() => lock(!locked)} aria-pressed={locked} aria-label="Lock the brief" /><span><b>{locked ? 'Locked' : 'Editing'}</b><div className="caption">{locked ? 'Scripts use this version. Unlock to change it.' : 'Lock it once the clinic agrees.'}</div></span></div>
          <button className="btn plain sm" onClick={async () => { try { const r = await api.briefPdf(c.id); toast(r.pdf ? `Saved ${r.path.split('/').pop()} to Downloads` : r.note || 'Saved') } catch (e: any) { toast(e.message) } }}>{I.pdf()} Share as PDF</button>
        </div>
        <div className="card railcard">
          <b className="caption" style={{ fontWeight: 700 }}>On this page</b>
          {SECTION_ORDER.filter(([k]) => k !== 'posted' || b.posted).map(([k, t]) => <a key={k} href={'#b-' + k} className={'raillink' + (active === k ? ' on' : '')} onClick={e => { e.preventDefault(); jump(k) }}>{t}{(m.edited || []).includes(k) && <span className="editdot" title="Edited by you">●</span>}</a>)}
          {(m.edited || []).length > 0 && <span className="caption"><span className="editdot" style={{ marginLeft: 0, marginRight: 5 }}>●</span>edited by you</span>}
        </div>
        {(b.checks || []).length > 0 && <div className="railcard checks">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><b style={{ color: 'var(--c-amber)', flex: 1 }}>{b.checks.length} thing{b.checks.length === 1 ? '' : 's'} to check</b>{!locked && <button className="linkbtn" onClick={() => setEditing('checks')}>Edit list</button>}</div>
          <div className="caption" style={{ lineHeight: 1.45 }}>{locked ? 'Unlock the brief to answer these.' : 'Answer one and it is saved for the next redraft; or tick it off if it no longer matters.'}</div>
          {(allChecks ? b.checks : b.checks.slice(0, 4)).map((x: string, i: number) => (
            <div key={i} className="checkitem">
              <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{x}</div>
              {!locked && <div style={{ display: 'flex', gap: 6 }}><button className="btn plain sm" onClick={() => answerCheck(i)}>Answer</button><button className="btn plain sm" onClick={() => dropCheck(i)} title="Remove from the list">{I.check({ width: 11, height: 11 })} Done</button></div>}
            </div>
          ))}
          {b.checks.length > 4 && <button className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setAllChecks(!allChecks)}>{allChecks ? 'Show fewer' : `Show all ${b.checks.length}`}</button>}
          {editing === 'checks' && <TextEdit value={(b.checks || []).join('\n')} rows={5} onSave={t => saveBrief({ checks: lines(t) }, 'checks')} onCancel={() => setEditing(null)} />}
        </div>}
        <div className="card railcard">
          <b className="caption" style={{ fontWeight: 700 }}>Changes</b>
          {(m.history || []).slice(0, 6).map((h, i) => <div key={i} style={{ fontSize: 12.5 }}>{h.what}<div className="caption">{fmt.date(h.at)} {fmt.time(h.at.replace('T', ' '))}</div></div>)}
        </div>
      </aside>
    </div>
  )
}

function Src({ s }: { s: string }) { return <span className="srctag">{s}</span> }

function EditButtons({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button className="btn plain sm" type="button" onClick={onCancel}>Cancel</button><button className="btn sm" type="button" onClick={onSave}>Save</button></div>
}

function TextEdit({ value, rows = 3, hint, onSave, onCancel }: { value: string; rows?: number; hint?: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(value)
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <textarea className="inline" autoFocus rows={rows} value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave(v) }} />
    {hint && <span className="caption">{hint} · ⌘↩ to save</span>}
    <EditButtons onSave={() => onSave(v)} onCancel={onCancel} />
  </div>
}

function MultiEdit({ items, onSave, onCancel }: { items: { label: string; value: string }[]; onSave: (v: string[]) => void; onCancel: () => void }) {
  const [v, setV] = useState(items.map(x => x.value || ''))
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    {items.map((x, i) => <label key={i} className="formrow"><span>{x.label}</span><textarea className="inline" rows={2} autoFocus={i === 0} value={v[i]} onChange={e => setV(a => a.map((y, j) => j === i ? e.target.value : y))} /></label>)}
    <EditButtons onSave={() => onSave(v)} onCancel={onCancel} />
  </div>
}

function SayEdit({ say, never, onSave, onCancel }: { say: string[]; never: string[]; onSave: (s: string[], n: string[]) => void; onCancel: () => void }) {
  const [s, setS] = useState(say.join('\n'))
  const [n, setN] = useState(never.join('\n'))
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <label className="formrow"><span>Say <span className="caption">one per line</span></span><textarea className="inline" autoFocus rows={4} value={s} onChange={e => setS(e.target.value)} /></label>
    <label className="formrow"><span>Never say or show</span><textarea className="inline" rows={5} value={n} onChange={e => setN(e.target.value)} /></label>
    <EditButtons onSave={() => onSave(lines(s), lines(n))} onCancel={onCancel} />
  </div>
}

function ExtraEdit({ title, body, onSave, onCancel }: { title: string; body: string; onSave: (t: string, b: string) => void; onCancel: () => void }) {
  const [t, setT] = useState(title)
  const [b, setB] = useState(body)
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div className="field"><input value={t} onChange={e => setT(e.target.value)} placeholder="Section title" /></div>
    <textarea className="inline" autoFocus rows={5} value={b} onChange={e => setB(e.target.value)} />
    <span className="caption">Clear both to remove the section.</span>
    <EditButtons onSave={() => onSave(t.trim(), b.trim())} onCancel={onCancel} />
  </div>
}

function VoiceEdit({ voice, onSave, onCancel }: { voice: any; onSave: (v: any) => void; onCancel: () => void }) {
  const [v, setV] = useState({ clinical: 30, technical: 30, energy: 40, note: '', ...voice })
  // one number box per language, so a typo can't wipe the split
  const [mix, setMix] = useState<{ lang: string; pct: number }[]>(() => (voice?.mix || []).map((x: any) => ({ lang: x.lang, pct: Number(x.pct) || 0 })))
  const total = mix.reduce((a, x) => a + (x.pct || 0), 0)
  const save = () => {
    let m = mix.filter(x => x.lang)
    if (m.length === 1) m = [{ ...m[0], pct: 100 }]                                   // a single language is all of it
    else if (m.length > 1 && total === 0) m = m.map(x => ({ ...x, pct: Math.round(100 / m.length) }))
    onSave({ ...v, mix: m })
  }
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    {[['clinical', 'Warm', 'Clinical'], ['technical', 'Simple', 'Technical'], ['energy', 'Calm', 'Energetic']].map(([k, a, z]) => (
      <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><div className="ends caption"><span>{a}</span><span>{z}</span></div><input type="range" min={0} max={100} value={v[k]} onChange={e => setV({ ...v, [k]: Number(e.target.value) })} style={{ accentColor: 'var(--c-tint)' }} /></label>))}
    <div className="formrow"><span>Language mix <span className="caption" style={{ color: mix.length > 1 && total !== 100 ? 'var(--c-amber)' : 'var(--c-muted)' }}>{mix.length > 1 ? `adds up to ${total}%` : mix.length === 1 ? 'one language: 100%' : 'add the languages the reels use'}</span></span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {mix.map((x, i) => (
          <label key={x.lang} className="mixchip"><span>{LANGS[x.lang] || x.lang}</span>
            <input type="number" min={0} max={100} value={mix.length === 1 ? 100 : x.pct} disabled={mix.length === 1} onChange={e => setMix(m => m.map((y, j) => j === i ? { ...y, pct: Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) } : y))} aria-label={`${LANGS[x.lang] || x.lang} percent`} />
            <button type="button" onClick={() => setMix(m => m.filter((_, j) => j !== i))} aria-label={`Remove ${LANGS[x.lang] || x.lang}`} style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: '0 6px 0 0', font: 'inherit' }}>✕</button>
          </label>
        ))}
        <select className="chipsel empty" style={{ height: 30, flex: '0 0 auto', width: 'auto' }} value="" onChange={e => { if (e.target.value) setMix(m => [...m, { lang: e.target.value, pct: m.length ? 0 : 100 }]) }} aria-label="Add a language"><option value="">+ language</option>{Object.entries(LANGS).filter(([k]) => !mix.some(x => x.lang === k)).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
      </div>
    </div>
    <label className="formrow"><span>Note</span><div className="field"><input value={v.note || ''} onChange={e => setV({ ...v, note: e.target.value })} placeholder="Medical terms stay in English" /></div></label>
    <EditButtons onSave={save} onCancel={onCancel} />
  </div>
}

/* ---------------- References ---------------- */
function RefsView({ c, refs, reload, onGenerate }: { c: ClientDoc; refs: Ref[]; reload: () => void; onGenerate: (r: Ref) => void }) {
  const nameOf = useName()
  const { toast, words } = useContext(Ui)
  if (!refs.length) return (
    <div className="card pad" style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <b style={{ fontSize: 16 }}>No references yet</b>
      <div className="sub" style={{ lineHeight: 1.55 }}>On the <Link to="/reels">Reels</Link> page, pick reels that would work for {c.name} and choose <b>Send to › {c.name}</b>. Each one gets a <b>Generate similar</b> button here.</div>
    </div>
  )
  return (
    <div className="refgrid">
      {!c.brief && <div className="notebox" style={{ gridColumn: '1 / -1', flexDirection: 'row', alignItems: 'center' }}>{I.info()}<span className="sub">Draft the brief on the Context tab first; scripts are written from it.</span></div>}
      {refs.map(r => (
        <div key={r.shortcode} className="card refcard">
          <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--c-tint)', lineHeight: 1.35, letterSpacing: '-.01em' }}>{r.hook_en || r.hook_original || r.caption?.split('\n')[0] || r.shortcode}</div>
          <div className="caption" style={{ color: 'var(--c-sub)' }}>{nameOf(r.clinic)}{r.format ? ' · ' + label(r.format) : ''}{r.language ? ' · ' + langName(r.language) : ''}{r.duration ? ' · ' + fmt.dur(r.duration) : ''}</div>
          <div style={{ display: 'flex', gap: 12, fontSize: 12.5 }}><b style={{ color: lrColor(r.like_rate) }}>{fmt.pct(r.like_rate)}</b><span className="sub">{fmt.n(r.views)} views</span>{r.scripts > 0 && <span className="pill tint" style={{ padding: '1px 8px' }}>{r.scripts} script{r.scripts === 1 ? '' : 's'}</span>}</div>
          {r.summary && <div className="sub" style={{ fontSize: 12.5, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.summary}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 'auto', paddingTop: 4 }}>
            <button className="btn sm" disabled={!c.brief} onClick={() => onGenerate(r)}>{I.spark({ width: 12, height: 12 })} Generate similar</button>
            <a href={r.url} target="_blank" rel="noreferrer" className="caption" style={{ fontWeight: 600, color: 'var(--c-tint)' }}>Instagram {I.ext({ width: 10, height: 10 })}</a>
            <span className="spacer" />
            <button className="iconbtn" title={`Remove from ${words.one.toLowerCase()}`} aria-label="Remove reference" onClick={async () => { await api.clientRefsRemove(c.id, [r.shortcode]); reload(); toast('Reference removed', async () => { await api.clientRefsAdd(c.id, [r.shortcode]); reload() }) }}>{I.trash()}</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function GenerateSheet({ c, refReel, onClose, onMade }: { c: ClientDoc; refReel: Ref | null; onClose: () => void; onMade: (sid: number) => void }) {
  const nameOf = useName()
  const lead = c.people.find(p => p.lead) || c.people[0]
  const langs = [...new Set([...(c.languages || []), ...SCRIPT_LANGS.slice(0, 3)])]
  const [person, setPerson] = useState(lead?.id || '')
  const [language, setLanguage] = useState(c.languages[0] || 'en')
  const [closeness, setCloseness] = useState(refReel ? 'structure' : 'loose')
  const [cast, setCast] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try { const r = await api.scriptNew(c.id, refReel ? { shortcode: refReel.shortcode, person_id: person || null, language, closeness, cast, note } : { topic: note.trim(), person_id: person || null, language, closeness: 'loose', cast }); onMade(r.id) }
    catch (e: any) { setErr(e.message); setBusy(false) }
  }
  return createPortal(
    <div className="sheet-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="card sheet" style={{ width: 540 }} onSubmit={e => { e.preventDefault(); if (refReel || note.trim()) go() }}>
        <b style={{ fontSize: 17 }}>{refReel ? 'Generate similar' : 'New script from a topic'}</b>
        {refReel && <div className="notebox" style={{ gap: 4 }}><b style={{ color: 'var(--c-tint)' }}>{refReel.hook_en || refReel.shortcode}</b><span className="caption">{nameOf(refReel.clinic)} · {label(refReel.format)} · {fmt.pct(refReel.like_rate)} like-rate · {fmt.n(refReel.views)} views</span></div>}
        <div className="grid2" style={{ gap: 12 }}>
          <label className="formrow"><span>In the voice of</span><div className="field"><select value={person} onChange={e => setPerson(e.target.value)}>{c.people.map(p => <option key={p.id} value={p.id}>{p.name}{p.lead ? ' ★' : ''}</option>)}<option value="">The clinic (no one person)</option></select></div></label>
          <label className="formrow"><span>Language</span><div className="field"><select value={language} onChange={e => setLanguage(e.target.value)}>{langs.map(l => <option key={l} value={l}>{LANGS[l] || l}</option>)}</select></div></label>
        </div>
        {refReel && <div className="formrow"><span>How close to the reference</span>
          <div className="seg" style={{ alignSelf: 'flex-start' }}>{[['close', 'Same idea'], ['structure', 'Same structure, our topic'], ['loose', 'Just the hook style']].map(([k, l]) => <button type="button" key={k} className={closeness === k ? 'on' : ''} onClick={() => setCloseness(k)}>{l}</button>)}</div>
        </div>}
        <label className="formrow"><span>Who appears <span className="caption">optional</span></span><div className="field"><input value={cast} onChange={e => setCast(e.target.value)} placeholder="e.g. doctor and a receptionist; actors for the couple" /></div></label>
        <label className="formrow"><span>{refReel ? 'Anything else' : 'Topic'} {refReel && <span className="caption">optional</span>}</span><textarea className="inline" rows={3} autoFocus={!refReel} value={note} onChange={e => setNote(e.target.value)} placeholder={refReel ? 'e.g. make it about low AMH; keep it under 40 seconds' : 'What should the reel be about? e.g. "Is IVF painful?" from the front-desk questions'} /></label>
        {!refReel && <div className="caption">Claude picks the pattern that suits the topic from the best reels in {c.speciality || 'this speciality'}, then writes it for {c.name}.</div>}
        <div className="caption">Claude writes three hook options, the beats with {language === 'en' ? 'the lines' : 'each line in ' + (LANGS[language] || language) + ', romanised and in English'}, a caption, the claims for the doctor to confirm and an advertising check. It takes a minute or two.</div>
        {err && <div className="err">{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn plain" onClick={onClose}>Cancel</button>
          <button className="btn" type="submit" disabled={busy || (!refReel && !note.trim())}>{I.spark({ width: 13, height: 13 })} {busy ? 'Starting…' : 'Write script'}</button>
        </div>
      </form>
    </div>, document.body
  )
}

/* ---------------- Scripts ---------------- */
const STATUS: Record<string, [string, string]> = { queued: ['Waiting…', 'amber'], generating: ['Writing…', 'amber'], draft: ['Draft', 'grey'], review: ['With the doctor', 'tint'], approved: ['Approved', 'green'], failed: ['Failed', 'red'] }

function ScriptsView({ c, scripts: all, sid, reload, onNew }: { c: ClientDoc; scripts: Script[]; sid: number | null; reload: () => void; onNew: () => void }) {
  const nav = useNavigate()
  const [qs, setQs] = useSearchParams()
  const [plans, setPlans] = useState<Plan[]>([])
  useEffect(() => { api.plans(c.id).then(setPlans).catch(() => {}) }, [c.id, all.length])
  const filter = qs.get('plan') || ''
  const scripts = all.filter(s => !filter || (filter === 'single' ? !s.plan_id : String(s.plan_id) === filter))
  const current = sid ?? scripts[0]?.id ?? null
  const monthOf = (p: Plan) => { const [y, m] = p.month.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long' }) }
  return (
    <div className="scriptlayout">
      <div className="group scrollcol" style={{ alignSelf: 'start' }}>
        <div className="grouphead"><b>Scripts</b><span className="spacer" /><button className="linkbtn" disabled={!c.brief} title={c.brief ? '' : 'Draft the brief first'} onClick={onNew}>+ From a topic</button></div>
        {plans.length > 0 && <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--c-hair)' }}><div className="field" style={{ height: 28 }}><select value={filter} onChange={e => { const v = e.target.value; setQs(v ? { plan: v } : {}) }} style={{ fontSize: 12.5 }} aria-label="Show scripts from">
          <option value="">All scripts · {all.length}</option>
          {plans.map(p => <option key={p.id} value={String(p.id)}>{monthOf(p)} plan · {all.filter(s => s.plan_id === p.id).length}</option>)}
          <option value="single">Single scripts · {all.filter(s => !s.plan_id).length}</option>
        </select></div></div>}
        {scripts.length === 0 && <div className="emptyrow">No scripts yet. Use <b>Generate similar</b> on a reference, or write one from a topic.</div>}
        {scripts.map(s => (
          <button key={s.id} className={'srcrow' + (s.id === current ? ' on' : '')} onClick={() => nav(`/clients/${c.id}/scripts/${s.id}`)}>
            <span className="fill">
              <b style={{ fontSize: 13.5, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</b>
              <span className="caption" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--c-sub)' }}>{s.hook || s.ref_hook || ''}</span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, minWidth: 0 }}><span className={'pill ' + (STATUS[s.status]?.[1] || 'grey')} style={{ padding: '1px 8px', fontSize: 11 }}>{STATUS[s.status]?.[0] || s.status}</span><span className="caption" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{LANGS[s.language] || s.language}{s.pattern ? ' · ' + s.pattern : ''}</span></span>
            </span>
          </button>
        ))}
      </div>
      {current ? <ScriptDetail key={current} c={c} sid={current} onChange={reload} onGone={() => { reload(); nav(`/clients/${c.id}/scripts`) }} /> : <div />}
    </div>
  )
}

function ScriptDetail({ c, sid, onChange, onGone }: { c: ClientDoc; sid: number; onChange: () => void; onGone: () => void }) {
  const { toast } = useContext(Ui)
  const [s, setS] = useState<Script | null>(null)
  const [tele, setTele] = useState(false)
  const [review, setReview] = useState(false)
  const [show, setShow] = useState<{ rom: boolean; en: boolean }>(() => { try { return JSON.parse(localStorage.getItem('reely.script.show') || '') } catch { return { rom: true, en: true } } })
  const load = () => api.script(sid).then(setS).catch(() => onGone())
  useEffect(() => { load() }, [sid])
  useEffect(() => {
    if (s?.status !== 'generating' && s?.status !== 'queued') return
    const t = setInterval(load, 3000); return () => clearInterval(t)
  }, [s?.status])
  useEffect(() => { localStorage.setItem('reely.script.show', JSON.stringify(show)) }, [show])
  if (!s) return <div className="card pad"><span className="caption">Loading…</span></div>

  if (s.status === 'generating' || s.status === 'queued') return (
    <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><span className="ic spinner" style={{ width: 18, height: 18, flexBasis: 18 }}><span style={{ width: 16, height: 16 }} /></span><b style={{ fontSize: 16 }}>{s.status === 'queued' ? 'Waiting its turn' : 'Claude is writing this script'}</b></span>
      <span className="sub">{s.status === 'queued' ? 'Two scripts are written at a time; this one starts when a slot frees up.' : 'Usually one to three minutes.'} You can leave this page; it keeps going.</span>
      {s.title && s.title !== 'Writing…' && <span className="caption">{s.title}</span>}
    </div>
  )
  if (s.status === 'failed' || !s.data) return (
    <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
      <b style={{ fontSize: 16 }}>This script didn't finish</b>
      <div className="err" style={{ alignSelf: 'stretch' }}>{s.error || 'Unknown error'}</div>
      <div style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={async () => { await api.scriptRetry(sid); load(); onChange() }}>Try again</button><button className="btn plain" onClick={async () => { await api.scriptDelete(sid); onGone() }}>Delete</button></div>
    </div>
  )

  const d = s.data
  const person = c.people.find(p => p.id === s.person_id)
  const put = async (patch: Partial<ScriptData>) => { const data = { ...d, ...patch }; setS({ ...s, data }); try { setS(await api.scriptEdit(sid, { data })); onChange() } catch (e: any) { toast(e.message) } }
  const setStatus = async (status: string) => { setS(await api.scriptEdit(sid, { status })); onChange() }
  const hooks = d.hooks || []
  const pick = d.hook_pick || 0
  const multi = s.language !== 'en'
  const checked = new Set(d.checked || [])
  const setBeat = (i: number, k: string, v: string) => put({ beats: (d.beats || []).map((b, j) => j === i ? { ...b, [k]: v } : b) })
  const setHook = (i: number, k: string, v: string) => put({ hooks: hooks.map((h, j) => j === i ? { ...h, [k]: v } : h) })

  return (
    <div className="card scriptcard fade">
      {tele && <Teleprompter s={s} onClose={() => setTele(false)} />}
      {review && <ReviewShare s={s} onClose={() => setReview(false)} onSaved={n => { setS(n); onChange() }} />}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Inline value={d.title || s.title} onSave={v => put({ title: v })} style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-.02em' }} />
          <div className="sub" style={{ marginTop: 4 }}>{[LANGS[s.language] || s.language, d.duration_s ? `about ${d.duration_s}s` : null, person ? `in ${person.name}'s voice` : 'for the clinic', (d.on_camera || []).length ? 'on camera: ' + d.on_camera!.join(', ') : null].filter(Boolean).join(' · ')}</div>
          {(d.pattern || s.pattern) && <div className="caption" style={{ marginTop: 3 }}>Pattern: {d.pattern || s.pattern}</div>}
        </div>
        <div className="seg">{['draft', 'review', 'approved'].map(k => <button key={k} className={s.status === k ? 'on' : ''} onClick={() => setStatus(k)}>{STATUS[k][0]}</button>)}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => setReview(true)}>{I.pdf()} Review and share</button>
        <button className="btn plain sm" onClick={() => setTele(true)}>{I.play({ width: 11, height: 11 })} Teleprompter</button>
        {multi && <><button className={'btn plain sm' + (show.rom ? ' on' : '')} onClick={() => setShow({ ...show, rom: !show.rom })}>Romanised</button><button className={'btn plain sm' + (show.en ? ' on' : '')} onClick={() => setShow({ ...show, en: !show.en })}>English</button></>}
        <span className="spacer" />
        <HoldButton label="Delete script" ms={1500} onHold={async () => { await api.scriptDelete(sid); onGone() }} className="btn plain sm" />
      </div>
      {d.topic && <div className="sub" style={{ lineHeight: 1.5 }}>{d.topic}</div>}
      {s.ref && <RefCard r={s.ref} borrowed={d.borrowed} />}
      {multi && <div className="caption" style={{ color: 'var(--c-amber)' }}>Have a native speaker read the {LANGS[s.language] || s.language} lines before filming.</div>}

      <div className="sechead" style={{ padding: '6px 0 0' }}><span>Hook options · pick one</span></div>
      <div className="hookopts">
        {hooks.map((h, i) => (
          <div key={i} className={'hookopt' + (i === pick ? ' on' : '')} onClick={() => i !== pick && put({ hook_pick: i })}>
            <span className="hookstar">{i === pick ? '★' : '☆'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Inline value={h.line || ''} onSave={v => setHook(i, 'line', v)} style={{ fontWeight: 650, fontSize: 14.5 }} />
              {multi && show.rom && h.romanised && <Inline value={h.romanised} onSave={v => setHook(i, 'romanised', v)} className="rom" />}
              {multi && show.en && h.english && <Inline value={h.english} onSave={v => setHook(i, 'english', v)} className="gloss" />}
              {h.why && <div className="caption" style={{ marginTop: 4 }}>{h.why}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="sechead" style={{ padding: '6px 0 0' }}><span>Script</span><span className="caption" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>click any line to edit</span></div>
      <div className="beats">
        <div className="beat head"><span>Time</span><span>Who</span><span>Line</span><span>On screen</span></div>
        {(d.beats || []).map((b, i) => (
          <div key={i} className="beat">
            <Inline value={b.t || ''} onSave={v => setBeat(i, 't', v)} className="caption" />
            <Inline value={b.who || ''} onSave={v => setBeat(i, 'who', v)} style={{ fontSize: 12.5, fontWeight: 600 }} />
            <div>
              <Inline value={b.line || ''} onSave={v => setBeat(i, 'line', v)} multiline style={{ fontSize: 14, lineHeight: 1.55 }} />
              {multi && show.rom && b.romanised && <Inline value={b.romanised} onSave={v => setBeat(i, 'romanised', v)} multiline className="rom" />}
              {multi && show.en && b.english && <Inline value={b.english} onSave={v => setBeat(i, 'english', v)} multiline className="gloss" />}
            </div>
            <Inline value={b.visual || ''} onSave={v => setBeat(i, 'visual', v)} multiline className="caption" />
          </div>
        ))}
      </div>

      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="sect">
          <div className="sechead" style={{ padding: 0 }}><span>Claims for the doctor</span><span className="caption" style={{ textTransform: 'none', letterSpacing: 0 }}>{checked.size}/{(d.claims || []).length} confirmed</span></div>
          {(d.claims || []).map((x, i) => (
            <label key={i} className="claim"><input type="checkbox" checked={checked.has(i)} onChange={() => { const n = new Set(checked); n.has(i) ? n.delete(i) : n.add(i); put({ checked: [...n] }) }} /><span><span style={{ textDecoration: checked.has(i) ? 'line-through' : undefined, color: checked.has(i) ? 'var(--c-muted)' : undefined }}>{x.claim}</span><div className="caption">{x.check}</div></span></label>
          ))}
        </div>
        <div className="sect">
          <div className="sechead" style={{ padding: 0 }}><span>Advertising check (NMC)</span></div>
          {(d.compliance || []).map((x, i) => <div key={i} className="claim"><span style={{ color: x.ok ? 'var(--c-green)' : 'var(--c-amber)', fontWeight: 700, width: 15 }}>{x.ok ? '✓' : '!'}</span><span style={{ fontSize: 12.5 }}>{x.note}</span></div>)}
          <div className="caption">A first check by Claude, not legal advice.</div>
        </div>
      </div>

      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="sect"><div className="sechead" style={{ padding: 0 }}><span>Caption</span></div><Inline value={d.caption || ''} onSave={v => put({ caption: v })} multiline style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }} /><Inline value={(d.hashtags || []).join(' ')} onSave={v => put({ hashtags: v.split(/\s+/).filter(Boolean) })} className="caption" /></div>
        <div className="sect">
          <div className="sechead" style={{ padding: 0 }}><span>Ends with</span></div><Inline value={d.cta || ''} onSave={v => put({ cta: v })} style={{ fontWeight: 600 }} />
          {d.notes && <><div className="sechead" style={{ padding: '8px 0 0' }}><span>Shooting notes</span></div><Inline value={d.notes} onSave={v => put({ notes: v })} multiline className="sub" /></>}
          {d.borrowed && !s.ref && <><div className="sechead" style={{ padding: '8px 0 0' }}><span>From the reference</span></div><div className="sub" style={{ lineHeight: 1.5 }}>{d.borrowed}</div></>}
        </div>
      </div>
    </div>
  )
}

function RefCard({ r, borrowed }: { r: NonNullable<Script['ref']>; borrowed?: string }) {
  const nameOf = useName()
  const [watch, setWatch] = useState(false)
  if (r.missing) return <div className="refreel"><div className="caption" style={{ fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>Reference reel</div><span className="sub">This reel isn't in this Mac's index any more.</span><a href={r.url} target="_blank" rel="noreferrer" className="caption" style={{ fontWeight: 600 }}>Open on Instagram {I.ext({ width: 10, height: 10 })}</a></div>
  return (
    <div className="refreel">
      <div style={{ display: 'flex', gap: 14 }}>
        {watch && r.video_url && <video className="refvideo" src={url(r.video_url)} controls autoPlay playsInline />}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="caption" style={{ fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>Reference reel</div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--c-tint)', lineHeight: 1.35 }}>{r.hook_en || r.hook_original || r.shortcode}</div>
          <div className="caption" style={{ color: 'var(--c-sub)' }}>{[nameOf(r.clinic), label(r.format), label(r.hook_type), langName(r.language), r.duration ? fmt.dur(r.duration) : null, r.date ? fmt.date(r.date) : null].filter(Boolean).join(' · ')}</div>
          <div style={{ display: 'flex', gap: 14, fontSize: 12.5, alignItems: 'baseline' }}><b style={{ color: lrColor(r.like_rate) }}>{fmt.pct(r.like_rate)} like-rate</b><span className="sub">{fmt.n(r.views)} views</span><span className="sub">{fmt.n(r.likes)} likes</span></div>
          {r.summary && <div className="sub" style={{ fontSize: 12.5, lineHeight: 1.5 }}><b style={{ color: 'var(--c-ink)', fontWeight: 600 }}>Why it worked:</b> {r.summary}</div>}
          {borrowed && <div className="sub" style={{ fontSize: 12.5, lineHeight: 1.5 }}><b style={{ color: 'var(--c-ink)', fontWeight: 600 }}>What this script takes from it:</b> {borrowed}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
            {r.video_url && <button className={'btn plain sm' + (watch ? ' on' : '')} onClick={() => setWatch(!watch)}>{I.play({ width: 10, height: 10 })} {watch ? 'Hide video' : 'Watch'}</button>}
            <a href={r.url} target="_blank" rel="noreferrer" className="btn plain sm">Instagram {I.ext({ width: 10, height: 10 })}</a>
            {!r.imported_ref && <Link to={`/reels/${r.clinic}`} className="btn plain sm">Open in Reels</Link>}
          </div>
        </div>
      </div>
    </div>
  )
}

function Inline({ value, onSave, multiline, style, className }: { value: string; onSave: (v: string) => void; multiline?: boolean; style?: React.CSSProperties; className?: string }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => { setEditing(false); if (v !== value) onSave(v) }
  if (editing) return multiline || v.length > 60
    ? <textarea className="inline" autoFocus value={v} rows={Math.min(8, Math.max(2, Math.ceil(v.length / 60)))} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Escape') { setV(value); setEditing(false) } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit() }} style={{ width: '100%' }} />
    : <input autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setV(value); setEditing(false) } }} style={{ ...style, width: '100%', border: '1px solid var(--c-tint)', borderRadius: 8, padding: '4px 8px', background: 'var(--c-card)', color: 'inherit', font: 'inherit' }} />
  return <div className={'editable ' + (className || '')} style={style} onClick={e => { e.stopPropagation(); setEditing(true) }} title="Click to edit">{value || <span className="caption">—</span>}</div>
}
