import { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ui } from '../App'
import { api, LANGS } from '../api'
import type { Script, ScriptData } from '../api'
import { I } from '../icons'

const store = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d } catch { return d } }

/** Full-screen teleprompter for the shoot: big lines, chosen hook first, optional auto-scroll. */
export function Teleprompter({ s, onClose }: { s: Script; onClose: () => void }) {
  const d = s.data || {}
  const multi = s.language !== 'en'
  const [o, setO] = useState(() => store('reely.prompter', { size: 44, speed: 40, rom: true, en: false, mirror: false }))
  const [playing, setPlaying] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { localStorage.setItem('reely.prompter', JSON.stringify(o)) }, [o])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setO(x => ({ ...x, speed: Math.min(160, x.speed + 10) })) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setO(x => ({ ...x, speed: Math.max(10, x.speed - 10) })) }
    }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, [])
  useEffect(() => {
    if (!playing) return
    let last = performance.now(), raf = 0, acc = 0
    const tick = (t: number) => {
      const el = box.current
      if (el) {
        acc += (t - last) / 1000 * o.speed; last = t
        if (acc >= 1) { el.scrollTop += Math.floor(acc); acc -= Math.floor(acc) }
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) setPlaying(false)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
  }, [playing, o.speed])
  const hook = (d.hooks || [])[d.hook_pick || 0]
  const blocks = [...(hook ? [{ t: 'Hook', who: '', line: hook.line, romanised: hook.romanised, english: hook.english }] : []), ...(d.beats || [])]
  return createPortal(
    <div className="prompter" role="dialog" aria-label="Teleprompter">
      <div className="prompter-bar">
        <b style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title || s.title}</b>
        <button className="pbtn" onClick={() => setPlaying(!playing)} title="Space">{playing ? 'Pause' : 'Play'}</button>
        <label className="pctl">Speed<input type="range" min={10} max={160} step={5} value={o.speed} onChange={e => setO({ ...o, speed: Number(e.target.value) })} /></label>
        <button className="pbtn" onClick={() => setO({ ...o, size: Math.max(24, o.size - 4) })} aria-label="Smaller text">A−</button>
        <button className="pbtn" onClick={() => setO({ ...o, size: Math.min(88, o.size + 4) })} aria-label="Larger text">A+</button>
        {multi && <button className={'pbtn' + (o.rom ? ' on' : '')} onClick={() => setO({ ...o, rom: !o.rom })}>Romanised</button>}
        {multi && <button className={'pbtn' + (o.en ? ' on' : '')} onClick={() => setO({ ...o, en: !o.en })}>English</button>}
        <button className={'pbtn' + (o.mirror ? ' on' : '')} onClick={() => setO({ ...o, mirror: !o.mirror })} title="For a teleprompter glass">Mirror</button>
        <button className="pbtn" onClick={onClose} title="Esc">Close</button>
      </div>
      <div ref={box} className="prompter-scroll" style={{ transform: o.mirror ? 'scaleX(-1)' : undefined }}>
        <div className="prompter-in" style={{ fontSize: o.size }}>
          {blocks.map((b, i) => (
            <div key={i} className="prompter-beat">
              <div className="prompter-who">{[b.who, b.t].filter(Boolean).join(' · ')}</div>
              <div>{b.line}</div>
              {multi && o.rom && b.romanised && <div className="prompter-rom">{b.romanised}</div>}
              {multi && o.en && b.english && <div className="prompter-en">{b.english}</div>}
            </div>
          ))}
          <div className="prompter-end">{d.cta}</div>
        </div>
      </div>
      <div className="prompter-line" aria-hidden />
    </div>, document.body)
}

/** Review step before the PDF: pick and edit the hook, edit any line, see unconfirmed claims, then save the PDF. */
export function ReviewShare({ s, onClose, onSaved }: { s: Script; onClose: () => void; onSaved: (s: Script) => void }) {
  const { toast } = useContext(Ui)
  const [d, setD] = useState<ScriptData>(() => JSON.parse(JSON.stringify(s.data || {})))
  const [markReview, setMarkReview] = useState(s.status === 'draft')
  const [withRef, setWithRef] = useState(false)
  const [busy, setBusy] = useState(false)
  const multi = s.language !== 'en'
  const pick = d.hook_pick || 0
  const open = (d.claims || []).length - (d.checked || []).length
  const setHook = (i: number, k: string, v: string) => setD({ ...d, hooks: (d.hooks || []).map((h, j) => j === i ? { ...h, [k]: v } : h) })
  const setBeat = (i: number, k: string, v: string) => setD({ ...d, beats: (d.beats || []).map((b, j) => j === i ? { ...b, [k]: v } : b) })
  const save = async (pdf: boolean) => {
    setBusy(true)
    try {
      const r = await api.scriptEdit(s.id, { data: d, ...(pdf && markReview ? { status: 'review' } : {}) })
      onSaved(r)
      if (pdf) {
        const p = await api.scriptPdf(s.id, withRef)
        toast(p.pdf ? `Saved ${p.path.split('/').pop()} to Downloads` : p.note || 'Saved')
      } else toast('Changes saved')
      onClose()
    } catch (e: any) { toast(e.message); setBusy(false) }
  }
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [])
  const ta = (v: string | undefined, on: (v: string) => void, cls = '', rows = 2) => <textarea className={'inline ' + cls} rows={rows} value={v || ''} onChange={e => on(e.target.value)} style={{ minHeight: 0 }} />
  return createPortal(
    <div className="sheet-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="card sheet reviewsheet">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}><b style={{ fontSize: 17 }}>Review before sharing</b><span className="caption">{LANGS[s.language] || s.language} · edits are saved to the script</span></div>
        <div className="field" style={{ height: 36 }}><input value={d.title || ''} onChange={e => setD({ ...d, title: e.target.value })} style={{ fontWeight: 700, fontSize: 15 }} aria-label="Title" /></div>

        <div className="sechead" style={{ padding: 0 }}><span>Hook · the PDF leads with the one you pick</span></div>
        {(d.hooks || []).map((h, i) => (
          <div key={i} className={'hookopt' + (i === pick ? ' on' : '')} style={{ cursor: 'default' }}>
            <input type="radio" name="hook" checked={i === pick} onChange={() => setD({ ...d, hook_pick: i })} style={{ accentColor: 'var(--c-tint)', marginTop: 6 }} aria-label={`Use hook ${i + 1}`} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {ta(h.line, v => setHook(i, 'line', v))}
              {multi && ta(h.romanised, v => setHook(i, 'romanised', v), 'rom', 1)}
              {multi && ta(h.english, v => setHook(i, 'english', v), 'gloss', 1)}
            </div>
          </div>
        ))}

        <div className="sechead" style={{ padding: '6px 0 0' }}><span>Script</span></div>
        {(d.beats || []).map((b, i) => (
          <div key={i} className="reviewbeat">
            <div className="caption" style={{ fontWeight: 600 }}>{[b.t, b.who].filter(Boolean).join(' · ')}</div>
            {ta(b.line, v => setBeat(i, 'line', v))}
            {multi && ta(b.romanised, v => setBeat(i, 'romanised', v), 'rom', 1)}
            {multi && ta(b.english, v => setBeat(i, 'english', v), 'gloss', 1)}
          </div>
        ))}
        <label className="formrow"><span>Caption</span>{ta(d.caption, v => setD({ ...d, caption: v }), '', 3)}</label>
        <label className="formrow"><span>Ends with</span>{ta(d.cta, v => setD({ ...d, cta: v }), '', 1)}</label>

        <div className="notebox" style={{ gap: 6 }}>
          {open > 0 ? <span className="sub"><b style={{ color: 'var(--c-amber)' }}>{open} of {(d.claims || []).length} claims</b> aren't confirmed yet. The PDF lists every claim with a checkbox for the doctor.</span>
            : <span className="sub" style={{ color: 'var(--c-green)', fontWeight: 600 }}>Every claim is confirmed.</span>}
          {(d.compliance || []).some(x => !x.ok) && <span className="sub"><b style={{ color: 'var(--c-amber)' }}>Advertising check:</b> {(d.compliance || []).filter(x => !x.ok).map(x => x.note).join(' · ')}</span>}
          {multi && <span className="caption">Have a native speaker read the {LANGS[s.language] || s.language} lines.</span>}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={markReview} onChange={e => setMarkReview(e.target.checked)} style={{ accentColor: 'var(--c-tint)' }} /><span className="sub">Mark as <b>With the doctor</b> when the PDF is saved</span></label>
        {s.shortcode && <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={withRef} onChange={e => setWithRef(e.target.checked)} style={{ accentColor: 'var(--c-tint)' }} /><span className="sub">Add the reference reel at the end, for the shoot team <span className="caption">(leave off for the doctor)</span></span></label>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', position: 'sticky', bottom: -20, background: 'var(--c-card)', padding: '10px 0 0' }}>
          <button className="btn plain" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn plain" onClick={() => save(false)} disabled={busy}>Save changes</button>
          <button className="btn" onClick={() => save(true)} disabled={busy}>{I.pdf()} {busy ? 'Saving…' : 'Save and make PDF'}</button>
        </div>
      </div>
    </div>, document.body)
}
