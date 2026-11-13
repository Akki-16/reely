import { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Ui } from '../App'
import { api } from '../api'
import type { ClientSummary } from '../api'
import { I } from '../icons'

/** "Send to" menu: the hook library, or any client's references. Replaces the old Add to library button. */
export default function SendTo({ codes: given, load, inLib, onLibrary, onDone, align = 'right', label = 'Send to', heading, className = 'btn plain sm' }: {
  codes: string[]; inLib?: boolean; onLibrary: (codes: string[]) => void | Promise<void>; onDone?: () => void; align?: 'left' | 'right'; label?: string
  /** For "Send all": fetch the reel codes when the menu opens, so a list of buttons doesn't each load its reels. */
  load?: () => Promise<string[]>
  /** A line at the top of the menu saying what is being sent. */
  heading?: React.ReactNode
  className?: string
}) {
  const [loaded, setLoaded] = useState<string[] | null>(null)
  const codes = load ? (loaded || []) : given
  const { toast, words, spec } = useContext(Ui)
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [clients, setClients] = useState<ClientSummary[]>([])
  const [has, setHas] = useState<Record<string, number>>({})
  const [q, setQ] = useState('')
  const [naming, setNaming] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<React.CSSProperties>({})
  // the menu floats (position: fixed) so a scrolling card or table around the button can't clip it
  const place = () => {
    const r = btn.current?.getBoundingClientRect(); if (!r) return
    const w = 290, left = Math.min(Math.max(8, align === 'left' ? r.left : r.right - w), window.innerWidth - w - 8)
    const below = window.innerHeight - r.bottom > 360
    setPos(below ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 })
  }

  useEffect(() => {
    if (!open) return
    api.clients().then(setClients).catch(() => {})
    if (load) { setLoaded(null); setHas({}); load().then(c => { setLoaded(c); api.sendCheck(c).then(setHas).catch(() => {}) }).catch(() => setLoaded([])) }
    else api.sendCheck(given).then(setHas).catch(() => {})
    const h = (e: MouseEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) close() }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const sc = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) close() }
    place()
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k); window.addEventListener('scroll', sc, true); window.addEventListener('resize', close)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); window.removeEventListener('scroll', sc, true); window.removeEventListener('resize', close) }
  }, [open])
  const close = () => { setOpen(false); setQ(''); setNaming(null) }

  const sendTo = async (c: { id: number; name: string }) => {
    close()
    try {
      const r = await api.clientRefsAdd(c.id, codes)
      const n = r.added.length
      if (!n) { toast(codes.length === 1 ? `Already in ${c.name}` : `All of these are already in ${c.name}`); return }
      toast(`${n} reel${n === 1 ? '' : 's'} sent to ${c.name}${codes.length > n ? ` · ${codes.length - n} already there` : ''}`,
        async () => { await api.clientRefsRemove(c.id, r.added) })
      onDone?.()
    } catch (e: any) { toast(e.message) }
  }
  const createAndSend = async () => {
    const name = (naming || '').trim()
    if (!name) return
    try { const c = await api.clientNew({ name, speciality: spec || null }); await sendTo(c); nav(`/clients/${c.id}`) } catch (e: any) { toast(e.message) }
  }

  const list = clients.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()))
  // clients in the current speciality first
  list.sort((a, b) => Number(b.speciality === spec) - Number(a.speciality === spec))

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button ref={btn} className={className + (open ? ' on' : '')} onClick={e => { e.stopPropagation(); setOpen(v => !v) }} aria-haspopup="menu" aria-expanded={open}
        title="Send to the hook library or a client">
        {I.send()} {label} {I.down({ width: 10, height: 10 })}
      </button>
      {open && createPortal(
        <div ref={menuRef} className="card menu sendto" role="menu" onClick={e => e.stopPropagation()} style={{ width: 290, color: 'var(--c-ink)', position: 'fixed', right: 'auto', zIndex: 200, transformOrigin: align === 'left' ? 'top left' : 'top right', ...pos }}>
          {heading && <div className="caption" style={{ padding: '6px 8px 4px', lineHeight: 1.4 }}>{heading}</div>}
          {load && !loaded && <div className="caption" style={{ padding: '2px 8px 6px' }}>Counting the reels…</div>}
          {clients.length > 4 && <div className="field" style={{ margin: '2px 2px 4px', height: 28 }}>{I.search()}<input autoFocus placeholder={`Find a ${words.one.toLowerCase()}`} value={q} onChange={e => setQ(e.target.value)} /></div>}
          <button className="row" role="menuitem" disabled={!codes.length} onClick={async () => { close(); await onLibrary(codes) }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}><span className="sendic" style={{ background: 'rgba(245,166,35,.16)', color: '#C77C00' }}>{inLib ? I.starFill({ width: 13, height: 13 }) : I.star({ width: 13, height: 13 })}</span>Hook library</span>
            <span className="caption">{inLib ? 'in library · remove' : 'your swipe file'}</span>
          </button>
          <div className="caption" style={{ padding: '8px 8px 3px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', fontSize: 10.5 }}>{words.many}</div>
          {list.length === 0 && !naming && <div className="caption" style={{ padding: '2px 8px 6px' }}>{clients.length ? 'No match.' : `No ${words.many.toLowerCase()} yet.`}</div>}
          <div style={{ maxHeight: 260, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {list.map(c => {
              const n = has[String(c.id)] || 0
              return (
                <button key={c.id} className="row" role="menuitem" disabled={!codes.length} onClick={() => sendTo(c)}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}><span className="sendic" style={{ background: c.color || 'var(--c-tint)', color: '#fff', fontWeight: 700, fontSize: 11 }}>{c.name.slice(0, 1).toUpperCase()}</span><span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span></span>
                  <span className="caption" style={n ? { color: 'var(--c-green)', fontWeight: 600 } : undefined}>{codes.length > 1 ? (n ? `${codes.length - n} new · ${n} there` : `${codes.length} new`) : n ? 'already there' : (c.speciality || '')}</span>
                </button>
              )
            })}
          </div>
          <div style={{ borderTop: '1px solid var(--c-hair)', margin: '4px 0 2px' }} />
          {naming == null
            ? <button className="row" role="menuitem" style={{ color: 'var(--c-tint)', fontWeight: 600, justifyContent: 'flex-start', gap: 6 }} onClick={() => setNaming('')}>{I.plus()} New {words.one.toLowerCase()}…</button>
            : <form className="row" style={{ gap: 6 }} onSubmit={e => { e.preventDefault(); createAndSend() }}>
                <input autoFocus value={naming} onChange={e => setNaming(e.target.value)} placeholder={`${words.one} name`} aria-label={`New ${words.one.toLowerCase()} name`} style={{ flex: 1, minWidth: 0, border: 0, background: 'var(--c-fill)', borderRadius: 6, padding: '5px 8px', font: 'inherit', fontSize: 12.5, color: 'inherit' }} />
                <button className="btn sm" type="submit" disabled={!naming.trim()} style={{ height: 26, padding: '0 10px' }}>Create</button>
              </form>}
        </div>, document.body
      )}
    </div>
  )
}
