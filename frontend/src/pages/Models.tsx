import { useContext, useEffect, useState } from 'react'
import { Info, NumberPick, Toolbar, Ui } from '../App'
import type { Theme } from '../App'
import { LANGS } from '../api'
import type { Health } from '../App'
import { api, fmt } from '../api'
import type { Engine, Model, ModelNotes } from '../api'
import { UpdatesSection } from '../updater'
import { I } from '../icons'

export default function Models({ health, onHealth }: { health: Health; onHealth: (h: Health | ((h: Health) => Health)) => void }) {
  const [models, setModels] = useState<Model[]>([])
  const [engines, setEngines] = useState<Engine[]>([])
  const [notes, setNotes] = useState<ModelNotes | null>(null)
  const [cache, setCache] = useState<{ bytes: number; path: string } | null>(null)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [tools, setTools] = useState<any>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [loginErr, setLoginErr] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [testing, setTesting] = useState(false)
  const [del, setDel] = useState<string | null>(null)

  const load = () => { api.models().then(m => { setModels(m.models); setCache(m.cache); setEngines(m.engines || []); setNotes(m.notes || null) }); api.settings().then(setSettings); api.tools().then(setTools) }
  useEffect(() => { load(); const t = setInterval(load, 2500); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (!loginOpen) return
    const t = setInterval(async () => {
      const r = await api.browserLoginResult()
      if (!r.open) {
        setLoginOpen(false)
        if (r.result?.error) setLoginErr(r.result.error)
        const b = await api.browserStatus(); onHealth(h => ({ ...h, browser: b }))
      }
    }, 2000)
    return () => clearInterval(t)
  }, [loginOpen])
  useEffect(() => {
    if (!installing) return
    const t = setInterval(async () => {
      const s = await api.browserInstallStatus()
      if (!s.running) { setInstalling(false); if (s.result && !s.result.ok) setLoginErr('Browser install failed: ' + s.result.log.slice(-300)); load() }
    }, 3000)
    return () => clearInterval(t)
  }, [installing])
  const browserInstalled = tools?.browser?.installed !== false

  const set = async (k: string, v: string) => { const s = await api.putSettings({ [k]: v }); setSettings(s); if (k === 'whisper_model' || k === 'whisper_engine') onHealth(h => ({ ...h, whisper: s.whisper_model })) }
  const anyDownloading = models.some(m => m.download?.status === 'running')
  const engine = settings.whisper_engine || 'faster-whisper'

  return (
    <>
      <Toolbar title="Settings">
        <span className="caption">Model cache · {cache ? fmt.bytes(cache.bytes) : '…'} used · {tools ? fmt.bytes(tools.free_bytes) : '…'} free</span>
      </Toolbar>
      <div className="main"><div className="main-inner">
        <div>
          <h1 className="large">Settings</h1>
          <div className="lead">Appearance, updates, speech-to-text models, the Claude CLI and the scraping browser.</div>
        </div>

        <div className="settings-top">
          <AppearanceSection />
          <UpdatesSection />
        </div>

        <NamesSection />

        {health.viewOnly ? (
          <div className="notebox" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <div className="ic tint" style={{ width: 32, height: 32 }}>{I.info({ width: 15, height: 15 })}</div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}><b>Speech-to-text is not part of this build.</b> This Mac runs the view-only Intel build: transcripts, translations and analysis arrive through Import from an Apple Silicon Mac.</div>
          </div>
        ) : (
        <div>
          <div className="sechead"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Speech-to-text<Info title="Speech-to-text" text={<>{notes?.families} <br /><br />{notes?.measured}</>} /></span>
            <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>Engine</span>
              <div className="field" style={{ height: 26 }}>
                <select aria-label="Transcription engine" value={engine} onChange={e => set('whisper_engine', e.target.value)} style={{ fontSize: 12 }}>
                  {(engines.length ? engines : [{ id: 'faster-whisper', name: 'faster-whisper', device: 'CPU', desc: '', available: true }]).map(e => <option key={e.id} value={e.id} disabled={!e.available}>{e.name} · {e.device}{e.available ? '' : ' (binary missing)'}</option>)}
                </select>
              </div>
              <span>Default model: <b style={{ color: 'var(--c-ink)' }}>{settings.whisper_model}</b></span>
            </span>
          </div>
          {[...(engine === 'whisper.cpp' ? ['whisper.cpp', 'faster-whisper'] : ['faster-whisper', 'whisper.cpp'])].map(engId => {
            const eng = engines.find(e => e.id === engId)
            const isGgmlGroup = engId === 'whisper.cpp'
            const rows = models.filter(m => m.engine === engId)
            if (!rows.length) return null
            return (
          <div key={engId} style={{ marginTop: engId === (engine === 'whisper.cpp' ? 'faster-whisper' : 'whisper.cpp') ? 22 : 0 }}>
            <div className="sechead" style={{ paddingTop: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{isGgmlGroup ? 'GPU models · Metal' : 'CPU models'}<Info title={isGgmlGroup ? 'GPU models · whisper.cpp on Metal' : 'CPU models · faster-whisper'} text={<>{eng?.desc} {isGgmlGroup ? 'GGML files from ggerganov/whisper.cpp.' : 'CTranslate2 models from the Hugging Face cache.'}<br /><br />{isGgmlGroup ? notes?.backups : notes?.cpu_rows}</>} /></span>
              {engId === engine && <span className="pill tint" style={{ padding: '2px 8px', fontSize: 11, textTransform: 'none', letterSpacing: 0 }}>Active engine</span>}
            </div>
          <div className="group">
            {rows.map(m => {
              const dl = m.download
              const pct = dl?.status === 'running' ? Math.min(99, Math.round((dl.bytes / dl.total) * 100)) : null
              const isDefault = settings.whisper_model === m.id
              const isGgml = m.engine === 'whisper.cpp'
              return (
                <div key={m.id}>
                <div className="grow" style={isDefault ? { background: 'var(--c-tint-soft)' } : undefined}>
                  <div className={'ic ' + (isDefault ? 'solid' : '')} style={{ fontSize: 11, fontWeight: 700 }}>{m.id.replace(/^ggml-/, '').replace('large-v3-', '').replace(/-q5_0$/, '').slice(0, 2).toUpperCase()}</div>
                  <div className="fill">
                    <div className="t">{m.id}<span className="pill grey" style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11 }}>{isGgml ? 'Metal GPU' : 'CPU'}</span>{isDefault && <span className="pill tint" style={{ marginLeft: 6, padding: '2px 8px', fontSize: 11 }}>Default</span>}</div>
                    <div className="s">{m.size_mb >= 1000 ? (m.size_mb / 1000).toFixed(1) + ' GB' : m.size_mb + ' MB'} · {m.speed} · {m.best_for}</div>
                    {m.note && <div className="caption" style={{ marginTop: 2 }}>{m.note}</div>}
                    {isDefault && m.translate_fallbacks && !models.some(x => m.translate_fallbacks!.includes(x.id) && x.installed) && <span className="pill red" style={{ marginTop: 6, padding: '2px 8px', fontSize: 11 }}>No translation model installed · English translation will come back in the source language</span>}
                    {pct != null && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}><div className="bar" style={{ flex: 1, maxWidth: 260 }}><div style={{ width: pct + '%' }} /></div><span className="caption">{pct}% · {fmt.bytes(dl!.bytes)} of {fmt.bytes(dl!.total)}</span></div>}
                    {dl?.status === 'error' && <div className="caption" style={{ color: 'var(--c-red)', marginTop: 4 }}>{dl.error}</div>}
                  </div>
                  {m.installed ? <>
                    <span className="pill green"><span className="dot" />Installed</span>
                    {!isDefault && <button className="btn plain sm" onClick={() => set('whisper_model', m.id)}>Make default</button>}
                    {!isDefault && (del === m.id
                      ? <button className="btn danger sm" onClick={() => { setDel(null); api.deleteModel(m.id).then(load) }}>Delete {fmt.bytes(m.size_on_disk)}?</button>
                      : <button className="btn plain sm" onClick={() => { setDel(m.id); setTimeout(() => setDel(d => d === m.id ? null : d), 3000) }}>Delete</button>)}
                  </> : pct != null ? <button className="btn plain sm" disabled>Downloading…</button>
                    : <><span className="caption">Not installed</span><button className="btn sm" disabled={anyDownloading} onClick={() => api.downloadModel(m.id).then(load)}>Download</button></>}
                </div>
                </div>
              )
            })}
          </div>
          </div>
            )
          })}
        </div>
        )}

        <div className="grid3" style={{ alignItems: 'start' }}>
          <div>
            <div className="sechead">Claude Code CLI</div>
            <div className="group">
              <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Status</div>{tools?.claude?.installed ? <span className="pill green"><span className="dot" />Installed</span> : <span className="pill grey">Not installed</span>}</div>
              <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Version</div><div className="sub">{tools?.claude?.version || '—'}</div></div>
              <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Annotation</div>
                <div className="field" style={{ height: 26 }}><select value={settings.annotation_mode || 'cli'} onChange={e => set('annotation_mode', e.target.value)} style={{ fontSize: 12 }}><option value="cli">Claude CLI</option><option value="handoff">Hand-off file</option><option value="none">Off</option></select></div></div>
              {!tools?.claude?.installed && <div className="grow" style={{ padding: '12px 16px' }}><div className="fill caption">Install with <code className="mono">npm install -g @anthropic-ai/claude-code</code>, then run <code className="mono">claude</code> once to sign in.</div></div>}
              <div className="grow" style={{ padding: '12px 16px', justifyContent: 'flex-end', gap: 8 }}><button className="btn plain sm" disabled={!tools?.claude?.installed || testing} onClick={async () => { setTesting(true); try { const r = await api.tools(); alert(r.claude.installed ? `Claude CLI ${r.claude.version} responds.` : 'Not found.') } finally { setTesting(false) } }}>Test</button></div>
            </div>
          </div>
          <div>
            <div className="sechead">Scraping browser</div>
            <div className="group">
              <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Status</div>{!browserInstalled ? <span className="pill grey">Chromium not installed</span> : health.browser?.logged_in ? <span className="pill green"><span className="dot" />Logged in</span> : <span className="pill amber"><span className="dot warn" />Not logged in</span>}</div>
              <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Engine</div><div className="sub">Playwright Chromium{browserInstalled ? '' : ' · ~150 MB download'}</div></div>
              {(loginErr || health.browser?.error) && <div className="grow" style={{ padding: '10px 16px' }}><div className="fill caption" style={{ color: 'var(--c-red)' }}>{loginErr || health.browser?.error}</div></div>}
              <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Account</div><div className="sub">Use a secondary Instagram account</div></div>
              <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Pacing</div><div className="sub">1s scroll · 3–7s between downloads</div></div>
              <div className="grow" style={{ padding: '12px 16px', justifyContent: 'flex-end', gap: 8 }}>
                {!browserInstalled
                  ? <button className="btn sm" disabled={installing} onClick={async () => { setLoginErr(null); await api.browserInstall(); setInstalling(true) }}>{installing ? 'Installing Chromium…' : 'Install browser'}</button>
                  : <>
                    {health.browser?.logged_in && <button className="btn danger sm" onClick={async () => { await api.browserLogout(); const b = await api.browserStatus(); onHealth(h => ({ ...h, browser: b })) }}>Log out</button>}
                    <button className="btn sm" disabled={loginOpen} onClick={async () => { setLoginErr(null); try { await api.browserLogin(); setLoginOpen(true) } catch (e: any) { setLoginErr(e.message) } }}>{loginOpen ? 'Window open… log in there' : health.browser?.logged_in ? 'Open window' : 'Log in'}</button>
                  </>}
              </div>
            </div>
          </div>
          <div>
            <div className="sechead">Run defaults &amp; storage</div>
            <div className="group">
              <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Scrape<div className="caption">How many tiles to collect, newest first</div></div><NumberPick value={settings.scrape_max || '0'} presets={[100, 200, 300, 500, 1000, 2000]} fmt={n => `Newest ${n}`} allValue="0" allLabel="All reels" onChange={v => set('scrape_max', v)} /></div>
              <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Analyse<div className="caption">Top reels by views to download and study</div></div><NumberPick value={settings.top_n || '100'} presets={[25, 50, 75, 100, 150, 200, 300, 500]} fmt={n => `Top ${n}`} allValue="100000" allLabel="All scraped" onChange={v => set('top_n', v)} /></div>
              <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Download pace<div className="caption">Starting pace. Slows down by itself on timeouts or limits, and stops downloading for now if Instagram blocks this network</div></div><div className="field" style={{ height: 26 }}><select value={settings.download_pace || 'balanced'} onChange={e => set('download_pace', e.target.value)} style={{ fontSize: 12 }}><option value="fast">Fast · 1–2 s</option><option value="balanced">Balanced · 3–7 s</option><option value="careful">Careful · 6–12 s</option></select></div></div>
              <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Video quality</div><div className="field" style={{ height: 26 }}><select value={settings.video_quality || 'low'} onChange={e => set('video_quality', e.target.value)} style={{ fontSize: 12 }}><option value="low">360p · low</option><option value="best">Best available</option></select></div></div>
              <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Translation</div><button className={'toggle' + (settings.translate === '1' ? ' on' : '')} aria-label="Toggle translation" onClick={() => set('translate', settings.translate === '1' ? '0' : '1')} /></div>
              {settings.translate === '1' && <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Translate to<div className="caption">{(settings.translate_to || 'en') === 'en' ? 'English comes from Whisper, straight from the audio' : 'Other languages go through Claude in batches'}</div></div><LangPick value={settings.translate_to || 'en'} onChange={v => set('translate_to', v)} /></div>}
              <div className="grow" style={{ padding: '12px 16px' }}><div className="fill" style={{ fontSize: 13 }}>Data folder</div><div className="sub" style={{ wordBreak: 'break-all', textAlign: 'right' }}>{tools?.data_root?.replace(/^.*\/SahiLabs\//, '…/') || '—'}</div></div>
              <div className="grow" style={{ padding: '12px 16px', justifyContent: 'flex-end' }}><button className="btn plain sm" onClick={() => api.reveal()}>Reveal in Finder</button></div>
            </div>
          </div>
        </div>
      </div></div>
    </>
  )
}

/** Language select with a "Custom…" entry to type any language name. */
function LangPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [custom, setCustom] = useState(false)
  const [draft, setDraft] = useState('')
  const known = value in LANGS
  const commit = () => { setCustom(false); const v = draft.trim(); if (v) onChange(v) }
  if (custom) return <div className="field" style={{ height: 26, width: 140 }}><input autoFocus placeholder="Language name" value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setCustom(false) }} style={{ fontSize: 12 }} aria-label="Custom language" /></div>
  return (
    <div className="field" style={{ height: 26 }}>
      <select value={known ? value : '__custom_v'} onChange={e => { if (e.target.value === '__custom') { setDraft(''); setCustom(true) } else onChange(e.target.value) }} style={{ fontSize: 12 }}>
        {Object.entries(LANGS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        {!known && <option value="__custom_v">{value}</option>}
        <option value="__custom">Custom…</option>
      </select>
    </div>
  )
}

/** Light, dark or follow macOS; moved here from the sidebar. */
const NAME_PRESETS: { one: string; many: string }[] = [{ one: 'Client', many: 'Clients' }, { one: 'Hospital', many: 'Hospitals' }, { one: 'Clinic', many: 'Clinics' }]

function NamesSection() {
  const { words, setWords } = useContext(Ui)
  const preset = NAME_PRESETS.find(p => p.one === words.one && p.many === words.many)
  const [custom, setCustom] = useState(!preset)
  const [draft, setDraft] = useState(words)
  useEffect(() => setDraft(words), [words])
  const commit = () => { const one = draft.one.trim(), many = draft.many.trim(); if (one && many && (one !== words.one || many !== words.many)) setWords({ one, many }) }
  return (
    <div>
      <div className="sechead">Names</div>
      <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div><b>What to call the people you make scripts for</b><div className="caption">Changes the sidebar, page titles and the Send to menu. Nothing is moved or renamed on disk.</div></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {NAME_PRESETS.map(p => <button key={p.one} className={'chipbtn' + (!custom && preset?.one === p.one ? ' on' : '')} style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => { setCustom(false); setWords(p) }}>{p.many}</button>)}
          <button className={'chipbtn' + (custom ? ' on' : '')} style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => setCustom(true)}>Custom…</button>
        </div>
        {custom && <div className="grid2" style={{ gap: 12, maxWidth: 460 }}>
          <label className="formrow"><span>One</span><div className="field"><input value={draft.one} onChange={e => setDraft({ ...draft, one: e.target.value })} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} placeholder="Partner" /></div></label>
          <label className="formrow"><span>Many</span><div className="field"><input value={draft.many} onChange={e => setDraft({ ...draft, many: e.target.value })} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} placeholder="Partners" /></div></label>
        </div>}
        <div className="notebox" style={{ gap: 4 }}>
          <span className="sub">Shows up as: sidebar <b>{words.many}</b> · button <b>New {words.one.toLowerCase()}</b> · menu <b>Send to › {words.many}</b></span>
          <span className="caption">The Instagram accounts Reely scrapes are called <b>reference accounts</b>, so they don't get mixed up with the {words.many.toLowerCase()} you work for.</span>
        </div>
      </div>
    </div>
  )
}

function AppearanceSection() {
  const { theme, setTheme } = useContext(Ui)
  const opts: { id: Theme; label: string }[] = [{ id: 'system', label: 'Match system' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]
  return (
    <div>
      <div className="sechead">Appearance</div>
      <div className="card pad appearance" role="radiogroup" aria-label="Appearance">
        {opts.map(o => (
          <button key={o.id} role="radio" aria-checked={theme === o.id} className={'apptile' + (theme === o.id ? ' on' : '')} onClick={() => setTheme(o.id)}>
            <span className={'appthumb ' + o.id}><span /><span /><span /></span>
            <span className="applabel">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
