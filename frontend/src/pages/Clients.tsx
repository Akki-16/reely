import { useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Toolbar, Ui } from '../App'
import { api, fmt, LANGS } from '../api'
import type { ClientSummary } from '../api'
import { I } from '../icons'
import { ImportSheet } from './Transfer'

export const SCRIPT_LANGS = ['te', 'hi', 'en', 'ta', 'kn', 'ml', 'mr', 'bn', 'gu']

export function Avatar({ name, color, size = 40, round }: { name: string; color?: string | null; size?: number; round?: boolean }) {
  const ini = name.replace(/^(dr\.?|doctor)\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
  return <span className="avatar" style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: round ? '50%' : size * .28, background: color || 'var(--c-tint)', fontSize: size * (round ? .36 : .4) }}>{round ? ini : name.slice(0, 1).toUpperCase()}</span>
}

export default function Clients() {
  const { words, spec } = useContext(Ui)
  const nav = useNavigate()
  const [list, setList] = useState<ClientSummary[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const load = () => api.clients().then(setList).catch(() => setList([]))
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t) }, [])
  const shown = (list || []).filter(c => !spec || c.speciality === spec)

  return (
    <>
      <Toolbar title={words.many}>
        <button className="btn plain sm" onClick={() => setImporting(true)} title="Bring in clients exported from another Mac">{I.download()} Import</button>
        <button className="btn sm" onClick={() => setAdding(true)}>{I.plus()} New {words.one.toLowerCase()}</button>
      </Toolbar>
      <div className="main"><div className="main-inner">
        <div>
          <h1 className="large">{words.many}</h1>
          <div className="lead">One room per {words.one.toLowerCase()}: who they are, the reels you sent them, and the scripts written for them.</div>
        </div>
        {list && shown.length === 0 && (
          <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
            <b style={{ fontSize: 15 }}>{list.length ? `No ${words.many.toLowerCase()} in ${spec}` : `No ${words.many.toLowerCase()} yet`}</b>
            <div className="sub" style={{ lineHeight: 1.5, maxWidth: 560 }}>Add one, then fill in its people, branches and links. Claude reads them and drafts a one-page brief. Send reels to it from the Reels page and press <b>Generate similar</b> to get a script in the lead doctor's voice.</div>
            <button className="btn" onClick={() => setAdding(true)}>{I.plus()} New {words.one.toLowerCase()}</button>
          </div>
        )}
        {shown.length > 0 && (
          <div className="clientgrid">
            {shown.map(c => (
              <button key={c.id} className="card clientcard" onClick={() => nav(`/clients/${c.id}`)}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <Avatar name={c.name} color={c.color} size={42} />
                  <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                    <div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '-.015em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                    <div className="caption">{[c.speciality, c.city].filter(Boolean).join(' · ') || 'No speciality set'}</div>
                  </div>
                  {I.fwd({ className: 'chev' })}
                </div>
                <div className="sub" style={{ textAlign: 'left', minHeight: 18 }}>{c.lead ? <>★ {c.lead}</> : c.people ? `${c.people} people` : 'No people added yet'}{c.branches > 1 ? ` · ${c.branches} branches` : ''}{c.languages.length ? ' · ' + c.languages.map(l => LANGS[l] || l).join(', ') : ''}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className={'pill ' + (c.has_brief ? (c.brief_locked ? 'green' : 'tint') : 'grey')}>{c.has_brief ? (c.brief_locked ? 'Brief locked' : 'Brief drafted') : 'No brief yet'}</span>
                  <span className="pill grey">{c.refs} reference{c.refs === 1 ? '' : 's'}</span>
                  <span className="pill grey">{c.scripts} script{c.scripts === 1 ? '' : 's'}</span>
                  {c.writing > 0 && <span className="pill amber">{c.writing} writing…</span>}
                  {c.review > 0 && <span className="pill tint">{c.review} with the doctor</span>}
                </div>
                <div className="caption" style={{ textAlign: 'left' }}>Updated {fmt.date(c.updated_at)}</div>
              </button>
            ))}
          </div>
        )}
      </div></div>
      {importing && <ImportSheet onClose={() => setImporting(false)} onDone={load} />}
      {adding && <NewClient onClose={() => setAdding(false)} onMade={id => nav(`/clients/${id}`)} />}
    </>
  )
}

function NewClient({ onClose, onMade }: { onClose: () => void; onMade: (id: number) => void }) {
  const { words, specialities, spec } = useContext(Ui)
  const [name, setName] = useState('')
  const [speciality, setSpeciality] = useState(spec || '')
  const [city, setCity] = useState('')
  const [langs, setLangs] = useState<string[]>(['te', 'en'])
  const [err, setErr] = useState('')
  const make = async () => {
    try { const c = await api.clientNew({ name: name.trim(), speciality: speciality || null, city: city.trim() || null, languages: langs }); onMade(c.id) }
    catch (e: any) { setErr(e.message) }
  }
  return (
    <div className="sheet-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="card sheet" style={{ width: 480 }} onSubmit={e => { e.preventDefault(); if (name.trim()) make() }}>
        <b style={{ fontSize: 17 }}>New {words.one.toLowerCase()}</b>
        <label className="formrow"><span>Name</span><div className="field"><input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Hospital or clinic name" /></div></label>
        <div className="grid2" style={{ gap: 12 }}>
          <label className="formrow"><span>Speciality</span><div className="field"><select value={speciality} onChange={e => setSpeciality(e.target.value)}><option value="">Choose…</option>{specialities.map(s => <option key={s} value={s}>{s}</option>)}</select></div></label>
          <label className="formrow"><span>City</span><div className="field"><input value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Hyderabad" /></div></label>
        </div>
        <div className="formrow"><span>Reel languages</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{SCRIPT_LANGS.map(l => <button type="button" key={l} className={'chipbtn' + (langs.includes(l) ? ' on' : '')} onClick={() => setLangs(v => v.includes(l) ? v.filter(x => x !== l) : [...v, l])}>{LANGS[l]}</button>)}</div>
        </div>
        <div className="caption">You add people, branches, websites and files next, inside the {words.one.toLowerCase()}'s room.</div>
        {err && <div className="err">{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn plain" onClick={onClose}>Cancel</button>
          <button className="btn" type="submit" disabled={!name.trim()}>Create</button>
        </div>
      </form>
    </div>
  )
}
