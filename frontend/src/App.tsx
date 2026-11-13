import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, isTauri, openExternal } from './api'
import type { Clinic } from './api'
import { I } from './icons'
import Clinics from './pages/Clinics'
import Run from './pages/Run'
import Reels from './pages/Reels'
import Insights from './pages/Insights'
import Models from './pages/Models'
import HowItWorks from './pages/HowItWorks'
import Library from './pages/Library'
import Clients from './pages/Clients'
import Categories from './pages/Categories'
import CategoriesLearn from './pages/CategoriesLearn'
import ClientRoom from './pages/ClientRoom'
import { SidebarUpdate, UpdateCard, UpdaterProvider } from './updater'

export type Health = { claude: any; browser: { logged_in?: boolean; installed?: boolean; error?: string }; whisper: string; viewOnly?: boolean }
export type Theme = 'system' | 'light' | 'dark'
/** What the people Acro makes scripts for are called (Settings › Names). */
export type Words = { one: string; many: string }
export type AskOptions = { title: string; label?: string; value?: string; placeholder?: string; note?: string; ok?: string; multiline?: boolean; optional?: boolean }

/** App-wide UI state: sidebar, and the speciality filter shared by every page. */
export const Ui = createContext<{
  sideOpen: boolean; setSideOpen: (v: boolean) => void
  spec: string; setSpec: (v: string) => void
  specialities: string[]; clinics: Clinic[]; refreshClinics: () => void
  toast: (msg: string, undo?: () => void) => void
  viewOnly: boolean
  theme: Theme; setTheme: (t: Theme) => void
  words: Words; setWords: (w: Words) => void
  /** The name to show for a reference account: the one you gave it, else its Instagram handle. */
  nameOf: (handle: string | null | undefined) => string
  /** An in-app text prompt. The desktop window has no window.prompt, so every rename goes through this. Resolves null on Cancel. */
  ask: (o: AskOptions) => Promise<string | null>
}>({ words: { one: 'Client', many: 'Clients' }, setWords: () => {}, nameOf: h => h || '', ask: async () => null,  sideOpen: true, setSideOpen: () => {}, spec: '', setSpec: () => {}, specialities: [], clinics: [], refreshClinics: () => {}, toast: () => {}, viewOnly: false, theme: 'system', setTheme: () => {} })

type ToastT = { id: number; msg: string; undo?: () => void }

function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
}

export default function App() {
  const [health, setHealth] = useState<Health>({ claude: {}, browser: {}, whisper: '' })
  const [sideOpen, setSideOpenState] = useState<boolean>(() => localStorage.getItem('reely.side') !== 'closed')
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem('reely.theme') as Theme) || 'system')
  const [spec, setSpecState] = useState(() => localStorage.getItem('reely.spec') || '')
  const [specialities, setSpecialities] = useState<string[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [words, setWordsState] = useState<Words>(() => { try { return JSON.parse(localStorage.getItem('reely.words') || '') } catch { return { one: 'Client', many: 'Clients' } } })
  const setWords = (w: Words) => { setWordsState(w); localStorage.setItem('reely.words', JSON.stringify(w)); api.putSettings({ client_one: w.one, client_many: w.many }).catch(() => {}) }
  const nav = useNavigate()
  const setSideOpen = (v: boolean) => { setSideOpenState(v); localStorage.setItem('reely.side', v ? 'open' : 'closed') }
  const setTheme = (t: Theme) => { setThemeState(t); localStorage.setItem('reely.theme', t); applyTheme(t) }
  const setSpec = (v: string) => { setSpecState(v); localStorage.setItem('reely.spec', v) }
  useEffect(() => { applyTheme(theme) }, [])

  const names = useMemo(() => Object.fromEntries(clinics.map(c => [c.handle, c.display_name || c.handle])), [clinics])
  const nameOf = (h: string | null | undefined) => (h && names[h]) || h || ''
  const [asking, setAsking] = useState<(AskOptions & { resolve: (v: string | null) => void }) | null>(null)
  const ask = (o: AskOptions) => new Promise<string | null>(resolve => setAsking({ ...o, resolve }))
  const [toasts, setToasts] = useState<ToastT[]>([])
  const toast = (msg: string, undo?: () => void) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t.slice(-2), { id, msg, undo }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), undo ? 6000 : 3000)
  }
  const refreshClinics = () => { api.overview().then(o => { setClinics(o.clinics); setSpecialities(o.specialities || []) }).catch(() => {}) }
  useEffect(() => { refreshClinics(); const id = setInterval(refreshClinics, 10000); return () => clearInterval(id) }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const [t, s] = await Promise.all([api.tools(), api.settings()])
        if (s.client_one && s.client_many) { const w = { one: s.client_one, many: s.client_many }; setWordsState(w); localStorage.setItem('reely.words', JSON.stringify(w)) }
        setHealth(h => ({ ...h, claude: t.claude, whisper: s.whisper_model, viewOnly: !!t.view_only, browser: { ...h.browser, installed: t.browser?.installed } }))
      } catch { /* server not up yet */ }
    }
    load(); const id = setInterval(load, 30000); return () => clearInterval(id)
  }, [])
  useEffect(() => {
    api.browserStatus().then(b => setHealth(h => ({ ...h, browser: { ...h.browser, ...b } }))).catch(() => {})
  }, [])

  // Inside the desktop shell, web links must leave the app through the system browser.
  useEffect(() => {
    if (!isTauri) return
    const h = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const href = a.getAttribute('href') || ''
      if (/^(https?:|mailto:)/.test(href)) { e.preventDefault(); openExternal(a.href) }
    }
    document.addEventListener('click', h); return () => document.removeEventListener('click', h)
  }, [])

  const toggle = <button className="iconbtn" aria-label={sideOpen ? 'Hide sidebar' : 'Show sidebar'} title={sideOpen ? 'Hide sidebar' : 'Show sidebar'} onClick={() => setSideOpen(!sideOpen)}>{I.sidebar()}</button>

  return (
    <Ui.Provider value={{ sideOpen, setSideOpen, spec, setSpec, specialities, clinics, refreshClinics, toast, viewOnly: !!health.viewOnly, theme, setTheme, words, setWords, nameOf, ask }}>
    <UpdaterProvider>
      <div className={'shell' + (sideOpen ? '' : ' noside')}>
        <aside className="side" aria-hidden={!sideOpen}>
          <div className="side-in">
            <div className="side-top" data-tauri-drag-region />
            <div className="brand" data-tauri-drag-region><b>Reely</b><span className="spacer" data-tauri-drag-region />{toggle}</div>
            <div className="sec">Research</div>
            <NavLink to="/clinics" className={({ isActive }) => 'nav' + (isActive ? ' on' : '')}>{I.clinics()}Overview</NavLink>
            <NavLink to="/run" className={({ isActive }) => 'nav' + (isActive ? ' on' : '')}>{I.run()}Run</NavLink>
            <NavLink to="/reels" className={({ isActive }) => 'nav' + (isActive ? ' on' : '')}>{I.reels()}Reels</NavLink>
            <NavLink to="/insights" className={({ isActive }) => 'nav' + (isActive ? ' on' : '')}>{I.insights()}Insights</NavLink>
            <NavLink to="/categories" className={({ isActive }) => 'nav' + (isActive ? ' on' : '')}>{I.grid()}Categories</NavLink>
            <NavLink to="/library" className={({ isActive }) => 'nav' + (isActive ? ' on' : '')}>{I.star()}Hook library</NavLink>
            <div className="sec" style={{ paddingTop: 16 }}>Work</div>
            <NavLink to="/clients" className={({ isActive }) => 'nav' + (isActive ? ' on' : '')}>{I.people()}{words.many}</NavLink>
            <div className="sec" style={{ paddingTop: 16 }}>Setup</div>
            <NavLink to="/settings" className={({ isActive }) => 'nav' + (isActive ? ' on' : '')}>{I.gear()}Settings</NavLink>
            <NavLink to="/how" className={({ isActive }) => 'nav' + (isActive ? ' on' : '')}>{I.help()}How it works</NavLink>
            <UpdateCard />
            <div className="status">
              <div><span className={'dot ' + (health.claude?.installed ? '' : 'off')} />{health.claude?.installed ? 'Claude CLI · signed in' : 'Claude CLI · not installed'}</div>
              {health.viewOnly
                ? <div title="Intel build: browse, edit, export and import here; scrape and transcribe on an Apple Silicon Mac"><span className="dot" style={{ background: 'var(--c-tint)' }} />View-only Mac</div>
                : <>
                  <div><span className="dot" />Whisper {health.whisper || '…'}</div>
                  <div><span className={'dot ' + (health.browser?.logged_in ? '' : health.browser?.installed === false ? 'off' : 'warn')} />{health.browser?.logged_in ? 'Browser signed in' : health.browser?.installed === false ? 'Browser · not installed' : 'Browser · log in needed'}</div>
                </>}
              <SidebarUpdate />
            </div>
          </div>
        </aside>
        <div className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/clinics" replace />} />
            <Route path="/clinics" element={<Clinics onRun={(id) => nav(`/run/${id}`)} />} />
            <Route path="/overview" element={<Navigate to="/clinics" replace />} />
            <Route path="/run" element={<Run />} />
            <Route path="/run/:id" element={<Run />} />
            <Route path="/reels" element={<Reels />} />
            <Route path="/reels/:handle" element={<Reels />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/insights/:handle" element={<Insights />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/categories/learn" element={<CategoriesLearn />} />
            <Route path="/library" element={<Library />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:id" element={<ClientRoom />} />
            <Route path="/clients/:id/:tab" element={<ClientRoom />} />
            <Route path="/clients/:id/:tab/:sid" element={<ClientRoom />} />
            <Route path="/settings" element={<Models health={health} onHealth={setHealth} />} />
            <Route path="/models" element={<Navigate to="/settings" replace />} />
            <Route path="/how" element={<HowItWorks />} />
          </Routes>
        </div>
      </div>
      {asking && <AskSheet o={asking} onDone={v => { asking.resolve(v); setAsking(null) }} />}
      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className="toast">
            <span>{t.msg}</span>
            {t.undo && <button onClick={() => { t.undo!(); setToasts(x => x.filter(y => y.id !== t.id)) }}>Undo</button>}
          </div>
        ))}
      </div>
    </UpdaterProvider>
    </Ui.Provider>
  )
}

function AskSheet({ o, onDone }: { o: AskOptions; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(o.value || '')
  const ok = o.optional || v.trim().length > 0
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(null) }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [])
  return (
    <div className="sheet-back" style={{ zIndex: 400 }} onMouseDown={e => { if (e.target === e.currentTarget) onDone(null) }}>
      <form className="card sheet" style={{ width: 440 }} onSubmit={e => { e.preventDefault(); if (ok) onDone(v.trim()) }}>
        <b style={{ fontSize: 17, letterSpacing: '-.015em' }}>{o.title}</b>
        <label className="formrow">{o.label && <span>{o.label}</span>}
          {o.multiline
            ? <textarea className="inline" autoFocus rows={3} value={v} placeholder={o.placeholder} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ok) onDone(v.trim()) }} />
            : <div className="field"><input autoFocus value={v} placeholder={o.placeholder} onChange={e => setV(e.target.value)} onFocus={e => e.target.select()} /></div>}
        </label>
        {o.note && <div className="caption" style={{ lineHeight: 1.5 }}>{o.note}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn plain" onClick={() => onDone(null)}>Cancel</button>
          <button className="btn" type="submit" disabled={!ok}>{o.ok || 'Save'}</button>
        </div>
      </form>
    </div>
  )
}

/** The display name of a reference account, for components that only need that. */
export const useName = () => useContext(Ui).nameOf

export function Toolbar({ title, children }: { title: string; children?: React.ReactNode }) {
  const { sideOpen, setSideOpen } = useContext(Ui)
  // the bar scrolls sideways when the window is narrow; an arrow on a blurred edge shows there is more
  const ref = useRef<HTMLElement>(null)
  const [more, setMore] = useState({ left: false, right: false })
  useEffect(() => {
    const el = ref.current; if (!el) return
    const check = () => {
      const left = el.scrollLeft > 4, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
      setMore(m => m.left === left && m.right === right ? m : { left, right })
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check); ro.observe(el); Array.from(el.children).forEach(c => ro.observe(c))
    const mo = new MutationObserver(check); mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => { el.removeEventListener('scroll', check); ro.disconnect(); mo.disconnect() }
  }, [])
  const go = (d: number) => ref.current?.scrollBy({ left: d * Math.max(200, ref.current.clientWidth * .6), behavior: 'smooth' })
  return (
    <header ref={ref} className="toolbar" data-tauri-drag-region aria-label={title}>
      <span className={'tb-edge left' + (more.left ? ' on' : '')}><button aria-label="Scroll the toolbar left" tabIndex={more.left ? 0 : -1} onClick={() => go(-1)}>{I.back({ width: 13, height: 13 })}</button></span>
      {!sideOpen && <button className="iconbtn" aria-label="Show sidebar" title="Show sidebar" onClick={() => setSideOpen(true)}>{I.sidebar()}</button>}
      <div className="spacer" data-tauri-drag-region />
      {children}
      <span className={'tb-edge right' + (more.right ? ' on' : '')}><button aria-label="Scroll the toolbar right" tabIndex={more.right ? 0 : -1} onClick={() => go(1)}>{I.fwd({ width: 13, height: 13 })}</button></span>
    </header>
  )
}

/** Speciality filter, shared across pages. */
export function SpecialityPicker({ allLabel = 'All specialities' }: { allLabel?: string }) {
  const { spec, setSpec, specialities, clinics } = useContext(Ui)
  const count = (s: string) => clinics.filter(c => c.speciality === s).length
  return (
    <div className="field">
      <select value={spec} onChange={e => setSpec(e.target.value)} aria-label="Speciality">
        <option value="">{allLabel}</option>
        {specialities.map(s => <option key={s} value={s}>{s}{count(s) ? ` · ${count(s)}` : ''}</option>)}
      </select>
    </div>
  )
}

/** Clinic filter: the clinics in the current speciality, plus an "all" entry. */
export function ClinicPicker({ value, onChange, allValue = '_all', allLabel = 'All accounts', bold }: { value: string; onChange: (v: string) => void; allValue?: string | null; allLabel?: string; bold?: boolean }) {
  const { spec, clinics } = useContext(Ui)
  const list = clinics.filter(c => !spec || c.speciality === spec)
  return (
    <div className="field">
      <select value={value} onChange={e => onChange(e.target.value)} aria-label="Reference account" style={bold ? { fontWeight: 600 } : undefined}>
        {allValue != null && <option value={allValue}>{allLabel}</option>}
        {list.map(c => <option key={c.handle} value={c.handle}>{c.display_name || c.handle}</option>)}
        {value && value !== allValue && !list.some(c => c.handle === value) && <option value={value}>{value}</option>}
      </select>
    </div>
  )
}

/** Re-mounts its children on route change so the page's enter animation plays. */
export function PageKey({ children }: { children: React.ReactNode }) {
  const loc = useLocation()
  return <div key={loc.pathname} className="page">{children}</div>
}

/** Press-and-hold button for destructive actions: the fill shows how long is left, release early to cancel. */
export function HoldButton({ label, holdLabel = 'Keep holding…', ms = 1400, onHold, className = 'btn plain', style, danger = true }: { label: string; holdLabel?: string; ms?: number; onHold: () => void; className?: string; style?: React.CSSProperties; danger?: boolean }) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<number | null>(null)
  const start = () => { if (timer.current) return; setHolding(true); timer.current = window.setTimeout(() => { timer.current = null; setHolding(false); onHold() }, ms) }
  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } setHolding(false) }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <button className={className + ' hold' + (holding ? ' holding' : '') + (danger ? ' danger-text' : '')} style={{ ...style, ['--hold-ms' as any]: ms + 'ms' }}
      onPointerDown={e => { e.preventDefault(); start() }} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start() }} onKeyUp={cancel}
      title={`Hold for ${(ms / 1000).toFixed(1)}s`} aria-label={label}>
      <span className="hold-fill" aria-hidden />
      <span className="hold-label" style={holding ? { visibility: 'hidden' } : undefined}>{label}</span>
      {holding && <span className="hold-label over" aria-hidden>{holdLabel}</span>}
    </button>
  )
}

/** Select with preset numbers plus a "Custom…" entry that turns into a number field. */
export function NumberPick({ value, presets, onChange, fmt, allValue, allLabel, min = 1 }: { value: string; presets: number[]; onChange: (v: string) => void; fmt: (n: number) => string; allValue?: string; allLabel?: string; min?: number }) {
  const [custom, setCustom] = useState(false)
  const [draft, setDraft] = useState(value)
  const isPreset = presets.map(String).includes(value) || value === allValue
  const commit = () => { const n = parseInt(draft, 10); setCustom(false); if (!isNaN(n) && n >= min) onChange(String(n)) }
  if (custom) return <div className="field" style={{ height: 26, width: 110 }}><input type="number" min={min} autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setCustom(false) }} style={{ fontSize: 12 }} aria-label="Custom number" /></div>
  return (
    <div className="field" style={{ height: 26 }}>
      <select value={isPreset ? value : '__custom_v'} onChange={e => { if (e.target.value === '__custom') { setDraft(isPreset && value !== allValue ? value : ''); setCustom(true) } else onChange(e.target.value) }} style={{ fontSize: 12 }}>
        {presets.map(n => <option key={n} value={String(n)}>{fmt(n)}</option>)}
        {allValue != null && <option value={allValue}>{allLabel}</option>}
        {!isPreset && <option value="__custom_v">{fmt(parseInt(value, 10))}</option>}
        <option value="__custom">Custom…</option>
      </select>
    </div>
  )
}

/** Small ⓘ button that opens a text popover; click anywhere else to close. */
export function Info({ text, title, align = 'left' }: { text: React.ReactNode; title?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
      <button className={'infobtn' + (open ? ' on' : '')} aria-label={title ? `About ${title}` : 'More information'} aria-expanded={open} onClick={() => setOpen(v => !v)}>{I.info()}</button>
      {open && <div className={'card infopop' + (align === 'right' ? ' right' : '')} role="dialog">{title && <b style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>{title}</b>}<div>{text}</div></div>}
    </span>
  )
}
