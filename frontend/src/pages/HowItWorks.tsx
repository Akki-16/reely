import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Toolbar } from '../App'
import { api } from '../api'
import { I } from '../icons'

/** The six stages, in the order a run executes them. */
const STEPS = [
  { n: 1, name: 'Scrape', tool: 'Playwright · saved login', out: 'reels_index.csv', icon: I.clinics, desc: 'Opens the clinic’s Reels grid in Reely’s own Chromium (logged in once), scrolls to the end and reads every tile’s play count and shortcode.' },
  { n: 2, name: 'Download', tool: 'yt-dlp · 360p', out: 'videos/<views>_<code>.mp4', icon: I.download, desc: 'Sorts the index by views and fetches only the top 100 at low quality, roughly 2 MB each. Files are named by view count so Finder sorts them the way you think.' },
  { n: 3, name: 'Transcribe', tool: 'Whisper · on this Mac (CPU or Metal GPU)', out: 'transcripts/<views>_<code>.json', icon: I.reels, desc: 'Listens to each video and writes the spoken words with timestamps. The first five seconds become the spoken hook.' },
  { n: 4, name: 'Translate', tool: 'Whisper translate task', out: 'text_en in each transcript', icon: I.spark, desc: 'Hindi, Telugu, Tamil and other non-English reels get an English rendering straight from the audio, which is more faithful than translating a garbled transcript.' },
  { n: 5, name: 'Annotate', tool: 'Claude Code CLI · your plan', out: 'annotations.json', icon: I.models, desc: 'Claude reads caption, hook and transcript for every reel and labels the hook type, format, call to action, and whether the reach looks organic or paid.' },
  { n: 6, name: 'Insights', tool: 'Claude Code CLI', out: 'top_annotated.csv · INSIGHTS.md', icon: I.insights, desc: 'Everything is merged into one sheet per clinic, and Claude writes INSIGHTS.md: what the like-rate says, which formats worked, which hooks to borrow.' },
]

export default function HowItWorks() {
  const [root, setRoot] = useState('~/Documents/Reely')
  useEffect(() => { api.overview().then(o => setRoot(o.data_root)).catch(() => {}) }, [])
  const short = root.replace(/^\/Users\/[^/]+/, '~')

  return (
    <>
      <Toolbar title="How it works" />
      <div className="main"><div className="main-inner">
        <div>
          <h1 className="large">How Reely works</h1>
          <div className="lead">One Instagram handle in, an annotated sheet of its best reels out. Every step runs on this Mac; nothing is uploaded anywhere except the questions you ask Claude.</div>
        </div>

        {/* 1 · the pipeline */}
        <section>
          <div className="sechead">The six stages of a run</div>
          <div className="flow">
            {STEPS.map((s, i) => (
              <div className="step" key={s.n} style={{ animationDelay: `${i * 70}ms` }}>
                <div className="ic tint" style={{ width: 34, height: 34, borderRadius: 10, flexBasis: 34 }}>{s.icon({ width: 16, height: 16 })}</div>
                <div className="step-n">{s.n}</div>
                <div className="step-name">{s.name}</div>
                <div className="step-tool">{s.tool}</div>
                <div className="step-out mono">{s.out}</div>
              </div>
            ))}
          </div>
          <div className="group" style={{ marginTop: 16 }}>
            {STEPS.map(s => (
              <div className="grow" key={s.n} style={{ alignItems: 'flex-start' }}>
                <div className="ic" style={{ flexBasis: 36 }}><span className="caption" style={{ fontWeight: 700, color: 'var(--c-ink)' }}>{s.n}</span></div>
                <div className="fill"><div className="t">{s.name} <span className="sub" style={{ fontWeight: 500 }}>· {s.tool}</span></div><div className="s" style={{ lineHeight: 1.5 }}>{s.desc}</div></div>
              </div>
            ))}
          </div>
        </section>

        {/* 2 · where data flows */}
        <section>
          <div className="sechead">Where the data flows</div>
          <div className="card pad" style={{ padding: '22px 24px 14px' }}>
            <FlowDiagram />
            <div className="caption" style={{ marginTop: 8, lineHeight: 1.5 }}>The clinic folder is the source of truth. Reely keeps a small SQLite index of it for the UI, and any edit you make in the inspector is written back to <span className="mono">annotations.json</span> so re-imports and exports keep it.</div>
          </div>
        </section>

        {/* 3 · reading the numbers */}
        <section className="grid2" style={{ alignItems: 'start' }}>
          <div>
            <div className="sechead">Reading like-rate</div>
            <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>Views can be bought; likes mostly can't. <b>Like-rate</b> is likes divided by views, and it separates creative that actually landed from creative that was simply promoted.</div>
              <Scale />
              <div className="caption" style={{ lineHeight: 1.5 }}>Organic reels usually sit between 1% and 5%. When an account's median is far below that, most of its reach was paid, and <b>Top by like-rate</b> is the ranking to trust. <b>vs median</b> shows how many times a reel beat its own account's median.</div>
            </div>
          </div>
          <div>
            <div className="sechead">Files on disk</div>
            <div className="card pad mono" style={{ fontSize: 12, lineHeight: 1.9, whiteSpace: 'pre', overflow: 'auto', color: 'var(--c-sub)' }}>
{`${short}/
└─ <handle>/
   ├─ clinic.json           speciality
   ├─ reels_index.csv       every reel + views
   ├─ videos/               <views>_<code>.mp4
   ├─ transcripts/          <views>_<code>.json
   ├─ annotations.json      Claude's labels + your edits
   ├─ top_reels_data.csv    the merged sheet
   └─ INSIGHTS.md           the write-up`}
            </div>
            <div className="caption" style={{ padding: '8px 4px 0' }}>Browser login lives in <span className="mono">.browser-profile/</span> beside the clinic folders. Whisper models sit in the Hugging Face cache and are managed from <Link to="/models">Models</Link>.</div>
          </div>
        </section>

        {/* 4 · what runs where */}
        <section>
          <div className="sechead">What runs where</div>
          <div className="grid3">
            {[
              ['On this Mac', 'Scraping, downloading and transcription. The only network traffic is to Instagram, the same as a browser would make.', 'green'],
              ['Your Claude plan', 'Annotation, insights and the Ask panel go through the Claude Code CLI signed in with your subscription. No API key, and usage counts against the same plan as chat.', 'tint'],
              ['Nothing hosted', 'There is no server and no account. Delete the folder and the data is gone. Export writes a CSV to Downloads whenever you want a copy.', ''],
            ].map(([h, d, k]) => (
              <div className="card pad" key={h} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className={'dot' + (k === 'green' ? '' : k === 'tint' ? ' tintdot' : ' off')} /><b style={{ fontSize: 13.5 }}>{h}</b></div>
                <div className="sub" style={{ lineHeight: 1.5 }}>{d}</div>
              </div>
            ))}
          </div>
        </section>
      </div></div>
    </>
  )
}

/** Swimlane diagram: tools on the top lane, files in the clinic folder below, the app at the end. */
function FlowDiagram() {
  const tools = [
    { x: 20, w: 140, t: 'Instagram', s: 'Reels grid', kind: 'src' },
    { x: 186, w: 140, t: 'Playwright', s: 'scrape' },
    { x: 352, w: 140, t: 'yt-dlp', s: 'download · 360p' },
    { x: 518, w: 140, t: 'Whisper', s: 'transcribe · translate' },
    { x: 684, w: 140, t: 'Claude CLI', s: 'annotate · insights' },
  ]
  const files = [
    { x: 186, w: 140, t: 'reels_index.csv' },
    { x: 352, w: 140, t: 'videos/*.mp4' },
    { x: 518, w: 140, t: 'transcripts/*.json' },
    { x: 684, w: 140, t: 'annotations.json' },
  ]
  const TY = 36, FY = 150, H = 50
  return (
    <svg viewBox="0 0 980 300" width="100%" style={{ display: 'block', fontFamily: 'var(--font)' }} role="img" aria-label="Data flow from Instagram through the tools into the clinic folder and the Reely index">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5 0 10z" fill="var(--c-muted)" /></marker>
      </defs>
      {/* lanes */}
      <text x="20" y="18" fontSize="11" fontWeight="600" fill="var(--c-muted)" letterSpacing=".04em">TOOLS</text>
      <text x="20" y="132" fontSize="11" fontWeight="600" fill="var(--c-muted)" letterSpacing=".04em">CLINIC FOLDER</text>
      <rect x="20" y="124" width="940" height="90" rx="14" fill="var(--c-fill)" />
      <text x="20" y="252" fontSize="11" fontWeight="600" fill="var(--c-muted)" letterSpacing=".04em">REELY</text>
      {/* tools */}
      {tools.map((b, i) => (
        <g key={b.t}>
          <rect x={b.x} y={TY} width={b.w} height={H} rx="12" fill={b.kind === 'src' ? 'var(--c-ink)' : 'var(--c-card)'} stroke={b.kind === 'src' ? 'none' : 'var(--c-tint)'} strokeWidth="1.5" />
          <text x={b.x + b.w / 2} y={TY + 21} textAnchor="middle" fontSize="13" fontWeight="600" fill={b.kind === 'src' ? 'var(--c-bg)' : 'var(--c-ink)'}>{b.t}</text>
          <text x={b.x + b.w / 2} y={TY + 38} textAnchor="middle" fontSize="11" fill={b.kind === 'src' ? 'var(--c-muted)' : 'var(--c-sub)'}>{b.s}</text>
          {i < tools.length - 1 && <line x1={b.x + b.w + 2} y1={TY + H / 2} x2={tools[i + 1].x - 3} y2={TY + H / 2} stroke="var(--c-muted)" strokeWidth="1.5" markerEnd="url(#arr)" />}
        </g>
      ))}
      {/* files, fed by the tool above each one */}
      {files.map(f => (
        <g key={f.t}>
          <line x1={f.x + f.w / 2} y1={TY + H + 2} x2={f.x + f.w / 2} y2={FY - 3} stroke="var(--c-muted)" strokeWidth="1.5" markerEnd="url(#arr)" />
          <rect x={f.x} y={FY} width={f.w} height={H} rx="10" fill="var(--c-card)" stroke="var(--c-hair)" />
          <text x={f.x + f.w / 2} y={FY + 29} textAnchor="middle" fontSize="12" fontFamily="var(--mono)" fill="var(--c-ink)">{f.t}</text>
        </g>
      ))}
      {/* merged outputs */}
      <line x1={files[3].x + files[3].w + 2} y1={FY + H / 2} x2={846 - 3} y2={FY + H / 2} stroke="var(--c-muted)" strokeWidth="1.5" markerEnd="url(#arr)" />
      <rect x="846" y={FY} width="94" height={H} rx="10" fill="var(--c-tint)" />
      <text x="893" y={FY + 21} textAnchor="middle" fontSize="12" fontWeight="600" fill="#fff">top sheet</text>
      <text x="893" y={FY + 37} textAnchor="middle" fontSize="11" fill="rgba(255,255,255,.8)">+ INSIGHTS.md</text>
      {/* app */}
      <line x1="480" y1={FY + H + 2 + 12} x2="480" y2="258" stroke="var(--c-muted)" strokeWidth="1.5" markerEnd="url(#arr)" />
      <rect x="186" y="262" width="588" height="30" rx="10" fill="var(--c-card)" stroke="var(--c-hair)" />
      <text x="480" y="281" textAnchor="middle" fontSize="12" fill="var(--c-ink)"><tspan fontWeight="600">SQLite index</tspan>  →  Clinics · Reels · Insights · Export. Edits flow back to annotations.json.</text>
    </svg>
  )
}

/** Like-rate scale: the three colour bands Reely uses, and the organic range. */
function Scale() {
  const bands = [
    { w: 20, c: 'var(--c-red)', l: '< 0.10%', t: 'promoted' },
    { w: 20, c: 'var(--c-amber)', l: '0.10–0.25%', t: 'mixed' },
    { w: 60, c: 'var(--c-green)', l: '≥ 0.25%', t: 'earned it' },
  ]
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
        {bands.map(b => <div key={b.l} className="scale-seg" style={{ width: b.w + '%', background: b.c }} />)}
      </div>
      <div style={{ display: 'flex', marginTop: 6 }}>
        {bands.map(b => <div key={b.l} style={{ width: b.w + '%', fontSize: 11.5 }}><b style={{ color: b.c }}>{b.l}</b> <span className="caption">{b.t}</span></div>)}
      </div>
      <div style={{ position: 'relative', height: 22, marginTop: 6 }}>
        <div style={{ position: 'absolute', left: '62%', right: 0, top: 0, height: 4, borderRadius: 2, background: 'var(--c-green-soft)' }} />
        <div className="caption" style={{ position: 'absolute', left: '62%', top: 8 }}>1–5% · typical organic range</div>
      </div>
    </div>
  )
}
