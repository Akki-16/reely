import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { api, fmt, isTauri } from './api'
import { I } from './icons'

/** Auto-update: Tauri's updater reads latest.json from the GitHub release, verifies the signature with the public
 * key baked into the app, swaps the .app in place and relaunches. Nothing installs while a run is active. */

type Phase = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
type State = { phase: Phase; version?: string; notes?: string; date?: string; current?: string; got?: number; total?: number; error?: string; checked?: number }
type Ctx = State & { check: (manual?: boolean) => Promise<void>; install: () => Promise<void>; restart: () => Promise<void>; auto: boolean; setAuto: (v: boolean) => void; busyRuns: number }

const UpdCtx = createContext<Ctx | null>(null)
export const useUpdater = () => useContext(UpdCtx)
const SIX_HOURS = 6 * 3600 * 1000

export function UpdaterProvider({ children }: { children: React.ReactNode }) {
  const [st, setSt] = useState<State>({ phase: 'idle' })
  const [auto, setAutoState] = useState(() => localStorage.getItem('reely.autoupdate') !== '0')
  const [busyRuns, setBusyRuns] = useState(0)
  const upd = useRef<any>(null)
  const setAuto = (v: boolean) => { setAutoState(v); localStorage.setItem('reely.autoupdate', v ? '1' : '0') }

  useEffect(() => {
    if (!isTauri) return
    import('@tauri-apps/api/app').then(m => m.getVersion()).then(v => setSt(s => ({ ...s, current: v }))).catch(() => {})
  }, [])
  // active runs block installing (the restart stops the backend)
  useEffect(() => {
    const t = () => api.queue().then(q => setBusyRuns(q.items.length)).catch(() => {})
    t(); const id = setInterval(t, 5000); return () => clearInterval(id)
  }, [])

  const check = async (manual = false) => {
    if (!isTauri) { if (manual) setSt(s => ({ ...s, phase: 'error', error: 'Updates work in the installed app only' })); return }
    if (st.phase === 'downloading' || st.phase === 'ready') return
    setSt(s => ({ ...s, phase: 'checking', error: undefined }))
    try {
      const { check: chk } = await import('@tauri-apps/plugin-updater')
      const u = await chk({ timeout: 20000 })
      upd.current = u
      setSt(s => u ? { ...s, phase: 'available', version: u.version, notes: u.body || '', date: u.date || '', checked: Date.now() }
        : { ...s, phase: 'none', checked: Date.now() })
    } catch (e: any) {
      // a missing release or no network is not worth bothering about unless the user asked
      setSt(s => ({ ...s, phase: manual ? 'error' : 'idle', error: String(e?.message || e).slice(0, 200), checked: Date.now() }))
    }
  }
  const install = async () => {
    const u = upd.current
    if (!u || busyRuns) return
    let got = 0
    setSt(s => ({ ...s, phase: 'downloading', got: 0, total: 0 }))
    try {
      await u.downloadAndInstall((ev: any) => {
        if (ev.event === 'Started') setSt(s => ({ ...s, total: ev.data?.contentLength || 0 }))
        else if (ev.event === 'Progress') { got += ev.data?.chunkLength || 0; setSt(s => ({ ...s, got })) }
        else if (ev.event === 'Finished') setSt(s => ({ ...s, phase: 'ready' }))
      })
      setSt(s => ({ ...s, phase: 'ready' }))
    } catch (e: any) {
      setSt(s => ({ ...s, phase: 'error', error: String(e?.message || e).slice(0, 200) }))
    }
  }
  const restart = async () => {
    if (busyRuns) return
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  }

  useEffect(() => {
    if (!auto || !isTauri) return
    const first = setTimeout(() => check(false), 8000)
    const id = setInterval(() => check(false), SIX_HOURS)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [auto])

  return <UpdCtx.Provider value={{ ...st, check, install, restart, auto, setAuto, busyRuns }}>{children}</UpdCtx.Provider>
}

/** Sidebar card, shown only when there is something to do. */
export function UpdateCard() {
  const u = useUpdater()
  if (!u || !['available', 'downloading', 'ready'].includes(u.phase)) return null
  const pct = u.total ? Math.round(((u.got || 0) / u.total) * 100) : null
  return (
    <div className="updcard rise">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{I.download({ width: 12, height: 12 })}<b style={{ fontSize: 12 }}>Reely {u.version}</b></div>
      {u.phase === 'available' && <>
        <span className="caption">{u.busyRuns ? `Update after ${u.busyRuns === 1 ? 'the run' : `${u.busyRuns} runs`} finish${u.busyRuns === 1 ? 'es' : ''}; installing restarts the app.` : 'A new version is ready to install.'}</span>
        <button className="btn sm" disabled={!!u.busyRuns} onClick={u.install}>Update</button>
      </>}
      {u.phase === 'downloading' && <>
        <div className="bar live" style={{ height: 5 }}><div style={{ width: (pct ?? 5) + '%' }} /></div>
        <span className="caption">Downloading{u.total ? ` · ${fmt.bytes(u.got || 0)} of ${fmt.bytes(u.total)}` : '…'}</span>
      </>}
      {u.phase === 'ready' && <>
        <span className="caption">{u.busyRuns ? 'Installed. Restart once the running batch is done.' : 'Installed. Restart to finish.'}</span>
        <button className="btn sm" disabled={!!u.busyRuns} onClick={u.restart}>Restart Reely</button>
      </>}
    </div>
  )
}

/** Settings page section: version, automatic checks, manual check. */
export function UpdatesSection() {
  const u = useUpdater()
  if (!u) return null
  const status = u.phase === 'checking' ? 'Checking…'
    : u.phase === 'none' ? `Up to date${u.checked ? ` · checked ${new Date(u.checked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
    : u.phase === 'available' ? `Reely ${u.version} is available`
    : u.phase === 'downloading' ? 'Downloading the update…'
    : u.phase === 'ready' ? 'Update installed · restart to finish'
    : u.phase === 'error' ? `Could not check: ${u.error}` : 'Not checked yet'
  return (
    <div>
      <div className="sechead">Updates</div>
      <div className="group">
        <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Version</div><div className="sub">{u.current || '—'}</div></div>
        <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Check automatically<div className="caption">At launch and every six hours. Updates only install when you press Update.</div></div><button className={'toggle' + (u.auto ? ' on' : '')} aria-label="Check for updates automatically" onClick={() => u.setAuto(!u.auto)} /></div>
        <div className="grow" style={{ padding: '12px 16px' }}>
          <div className="fill" style={{ fontSize: 13 }}>{status}{u.notes && u.phase === 'available' && <div className="caption" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{u.notes.slice(0, 400)}</div>}</div>
          {u.phase === 'available' ? <button className="btn sm" disabled={!!u.busyRuns} onClick={u.install}>{u.busyRuns ? 'Runs active' : 'Update'}</button>
            : u.phase === 'ready' ? <button className="btn sm" disabled={!!u.busyRuns} onClick={u.restart}>Restart</button>
            : <button className="btn plain sm" disabled={u.phase === 'checking' || u.phase === 'downloading'} onClick={() => u.check(true)}>Check now</button>}
        </div>
      </div>
    </div>
  )
}

/** Sidebar footer: a check button and the version line, in place of the old colour switch. */
export function SidebarUpdate() {
  const u = useUpdater()
  if (!u) return null
  const line = u.phase === 'checking' ? 'Checking…'
    : u.phase === 'available' ? `Reely ${u.version} is available`
    : u.phase === 'error' ? 'Could not check for updates'
    : `Reely ${u.current || ''}${u.phase === 'none' ? ' · up to date' : ''}`
  return (
    <div className="sideupd">
      <button className="btn plain sm" disabled={u.phase === 'checking' || u.phase === 'downloading'} onClick={() => u.check(true)} title={u.phase === 'error' ? u.error : undefined}>{I.refresh()} Check for updates</button>
      <span className="caption" style={{ textAlign: 'center' }}>{line}</span>
    </div>
  )
}
