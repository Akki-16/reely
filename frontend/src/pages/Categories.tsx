import { useContext, useEffect, useMemo, useState } from 'react'
import { ClinicPicker, SpecialityPicker, Toolbar, Ui } from '../App'
import { api, fmt, langName, lrColor } from '../api'
import type { CatCell, CatField, CatGroup, Categories as Cats, Reel } from '../api'
import { I } from '../icons'
import { Inspector, ReelPanel } from './Reels'
import SendTo from './SendTo'
import { Sheet } from './Transfer'

type View = 'list' | 'grid' | 'ranked'
type Sel = { av: string; bv: string | null }
const FIELDS: CatField[] = ['format', 'hook_type', 'flag', 'language']
const LABEL: Record<CatField, string> = { format: 'Format', hook_type: 'Hook type', flag: 'Flag', language: 'Language' }
const PLURAL: Record<CatField, string> = { format: 'Formats', hook_type: 'Hook types', flag: 'Flags', language: 'Languages' }

function useLocal<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(key); return s == null ? init : JSON.parse(s) } catch { return init } })
  useEffect(() => { localStorage.setItem(key, JSON.stringify(v)) }, [v])
  return [v, setV] as const
}
const show = (f: CatField, v: string) => f === 'language' ? (langName(v) || v) : v
const pct = (v: number | null | undefined) => v == null ? '—' : v.toFixed(2) + '%'

export default function Categories() {
  const { spec, toast, sideOpen } = useContext(Ui)
  const [clinic, setClinic] = useState('')
  const [view, setView] = useLocal<View>('reely.cat.view', 'grid')
  const [field, setField] = useLocal<CatField>('reely.cat.field', 'format')
  const [rowsF, setRowsF] = useLocal<CatField>('reely.cat.rows', 'format')
  const [colsF, setColsF] = useLocal<CatField>('reely.cat.cols', 'hook_type')
  const [organic, setOrganic] = useLocal<boolean>('reely.cat.organic', true)
  const [min, setMin] = useLocal<number>('reely.cat.min', 5)
  const [order, setOrder] = useLocal<'like_rate' | 'n'>('reely.cat.order', 'like_rate')
  const [sort, setSort] = useState<'like_rate' | 'views' | 'date'>('like_rate')
  const [data, setData] = useState<Cats | null>(null)
  const [sel, setSel] = useState<Sel | null>(null)
  const [reels, setReels] = useState<Reel[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Reel | null>(null)
  const [card, setCard] = useState<'open' | 'closing' | null>(null)
  const [lib, setLib] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState('en')
  const [tidy, setTidy] = useState(false)

  // list view crosses the chosen field with one other so a category can be narrowed; grid and ranked cross two chosen ones
  const a: CatField = view === 'list' ? field : rowsF
  const b: CatField = view === 'list' ? (field === 'hook_type' ? 'format' : 'hook_type') : colsF
  const scope = useMemo(() => ({ a, b, organic: String(organic), ...(clinic ? { clinic } : spec ? { speciality: spec } : {}) }), [a, b, organic, clinic, spec])
  const scopeKey = JSON.stringify(scope)

  const loadLib = () => api.library().then(rows => setLib(new Set(rows.map(r => r.shortcode)))).catch(() => {})
  useEffect(() => { loadLib(); api.settings().then(s => setTarget(s.translate_to || 'en')).catch(() => {}) }, [])
  useEffect(() => { setClinic('') }, [spec])
  const load = () => api.categories(scope).then(setData).catch(e => toast(e.message))
  useEffect(() => { setData(null); setSel(null); load() }, [scopeKey])
  useEffect(() => { setSel(null) }, [view])

  // grid view: bring the picked combination's reels into view below the grid
  useEffect(() => { if (view === 'grid' && sel) setTimeout(() => document.querySelector('.combocard')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60) }, [sel?.av, sel?.bv])

  const reelParams = (s: Sel) => ({ ...scope, av: s.av, ...(s.bv != null ? { bv: s.bv } : {}), sort })
  useEffect(() => {
    setPicked(new Set()); setPicking(false)
    if (!sel) { setReels(null); return }
    let alive = true
    setReels(null)
    api.categoryReels(reelParams(sel)).then(r => { if (alive) setReels(r.reels) }).catch(() => { if (alive) setReels([]) })
    return () => { alive = false }
  }, [sel?.av, sel?.bv, sort, scopeKey])

  const groupsA = (data?.a || []).filter(g => g.n >= min)
  const hiddenA = (data?.a.length || 0) - groupsA.length
  // list view opens on its first category so the right side is never empty
  useEffect(() => {
    if (view !== 'list' || sel || !groupsA.length) return
    const first = [...groupsA].sort((x, y) => order === 'n' ? y.n - x.n : y.like_rate - x.like_rate)[0]
    setSel({ av: first.value, bv: null })
  }, [view, data, sel, min, order])

  const toLibrary = async (codes: string[]) => {
    const r = await api.libraryAdd(codes); await loadLib()
    const n = r.added.length
    if (!n) { toast(codes.length === 1 ? 'Already in the library' : 'All of these are already in the library'); return }
    toast(`${n} reel${n === 1 ? '' : 's'} added to the library${codes.length > n ? ` · ${codes.length - n} already there` : ''}`, async () => { await api.libraryRemove(r.added); loadLib() })
  }
  const toggleLib = async (code: string) => {
    if (lib.has(code)) { await api.libraryRemove([code]); await loadLib(); toast('Removed from the library', async () => { await api.libraryAdd([code]); loadLib() }) }
    else await toLibrary([code])
  }
  const update = async (code: string, patch: Partial<Reel>) => {
    const r = await api.editReel(code, patch)
    setReels(rs => rs && rs.map(x => x.shortcode === code ? { ...x, ...r } : x))
    setOpen(o => o?.shortcode === code ? { ...o, ...r } : o)
  }
  const openReel = (r: Reel) => { setOpen(r); setCard('open') }
  const closeCard = () => { setCard('closing'); setTimeout(() => { setCard(c => c === 'closing' ? null : c) }, 230) }
  const codesOf = (s: Sel) => api.categoryReels(reelParams(s)).then(r => r.reels.map(x => x.shortcode))

  const selName = sel ? [show(a, sel.av), sel.bv != null ? show(b, sel.bv) : null].filter(Boolean).join(' × ') : ''
  const selGroup: CatGroup | CatCell | undefined = !sel ? undefined : sel.bv != null ? data?.cells.find(c => c.a === sel.av && c.b === sel.bv) : data?.a.find(g => g.value === sel.av)
  const scopeLabel = clinic || spec || 'all specialities'

  const reelList = (pad = '9px 18px') => (
    <>
      {reels == null && <div className="emptyrow">Loading…</div>}
      {reels?.length === 0 && <div className="emptyrow">No reels here.</div>}
      {reels?.map(r => (
        <div key={r.shortcode} className={'catreel' + (open?.shortcode === r.shortcode && card ? ' on' : '')} style={{ padding: pad }} onClick={() => openReel(r)}>
          {picking && <input type="checkbox" className="rowcheck" checked={picked.has(r.shortcode)} onClick={e => e.stopPropagation()} onChange={() => setPicked(p => { const n = new Set(p); n.has(r.shortcode) ? n.delete(r.shortcode) : n.add(r.shortcode); return n })} aria-label="Select this reel" />}
          <span className="catplay" aria-hidden>{I.play({ width: 10, height: 10 })}</span>
          <b style={{ width: 52, color: lrColor(r.like_rate) }}>{pct(r.like_rate)}</b>
          <div className="fill" style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.hook_en || r.hook_original || r.shortcode}</div>
            <div className="caption" style={{ color: 'var(--c-sub)' }}>{[r.clinic, sel?.bv == null ? r.hook_type : null, a !== 'format' && b !== 'format' ? r.format : null, fmt.dur(r.duration), fmt.n(r.views) + ' views', fmt.date(r.date)].filter(Boolean).join(' · ')}</div>
          </div>
          {lib.has(r.shortcode) && <span style={{ color: '#F5A623', display: 'flex' }} title="In the hook library">{I.starFill({ width: 13, height: 13 })}</span>}
          <SendTo codes={[r.shortcode]} inLib={lib.has(r.shortcode)} onLibrary={() => toggleLib(r.shortcode)} />
        </div>
      ))}
    </>
  )
  const actions = sel && (
    <>
      {picking && picked.size > 0 && <SendTo codes={[...picked]} onLibrary={toLibrary} label={`Send ${picked.size} selected`} onDone={() => { setPicked(new Set()); setPicking(false) }} />}
      <button className={'btn plain sm' + (picking ? ' on' : '')} onClick={() => { setPicking(!picking); setPicked(new Set()) }}>{picking ? 'Done' : 'Select'}</button>
      <SendTo codes={(reels || []).map(r => r.shortcode)} onLibrary={toLibrary} className="btn sm" label={`Send all ${reels?.length ?? selGroup?.n ?? ''}`}
        heading={<>Send all {reels?.length ?? ''} reels of <b style={{ color: 'var(--c-ink)' }}>{selName}</b> to</>} />
    </>
  )
  const stats = (g?: CatGroup | CatCell) => g && <span className="sub">{g.n} reel{g.n === 1 ? '' : 's'} · {g.accounts} account{g.accounts === 1 ? '' : 's'} · median like-rate <b style={{ color: lrColor(g.like_rate) }}>{pct(g.like_rate)}</b> · median views {fmt.n(g.views)}</span>
  const sortSeg = <div className="seg">{([['like_rate', 'Like-rate'], ['views', 'Views'], ['date', 'Date']] as const).map(([k, l]) => <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{l}</button>)}</div>

  return (
    <>
      <Toolbar title="Categories">
        <SpecialityPicker />
        <ClinicPicker value={clinic} onChange={setClinic} allValue="" />
        {view === 'list'
          ? <div className="seg">{FIELDS.map(f => <button key={f} className={field === f ? 'on' : ''} onClick={() => setField(f)}>{LABEL[f]}</button>)}</div>
          : <>
            <span className="caption">Rows</span>
            <div className="field"><select value={rowsF} onChange={e => { const v = e.target.value as CatField; if (v === colsF) setColsF(rowsF); setRowsF(v) }} aria-label="Rows" style={{ fontWeight: 600 }}>{FIELDS.map(f => <option key={f} value={f}>{LABEL[f]}</option>)}</select></div>
            <span className="caption">Columns</span>
            <div className="field"><select value={colsF} onChange={e => { const v = e.target.value as CatField; if (v === rowsF) setRowsF(colsF); setColsF(v) }} aria-label="Columns" style={{ fontWeight: 600 }}>{FIELDS.map(f => <option key={f} value={f}>{LABEL[f]}</option>)}</select></div>
          </>}
        <button className={'chipbtn' + (organic ? ' on' : '')} onClick={() => setOrganic(!organic)} title="Leave out paid, sponsored and collab reels, whose like-rates aren't comparable">{organic ? '✓ ' : ''}Organic only</button>
        <div className="field" title="Hide categories with fewer reels than this; a like-rate from one or two reels says little"><select value={min} onChange={e => setMin(Number(e.target.value))} aria-label="Minimum reels">{[1, 3, 5, 10, 20].map(n => <option key={n} value={n}>{n === 1 ? 'Any size' : `${n}+ reels`}</option>)}</select></div>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="View">{(['list', 'grid', 'ranked'] as View[]).map(v => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div>
      </Toolbar>
      <div className="main"><div className="main-inner wide" style={{ gap: 14 }}>
        {!data && <div className="empty">Loading…</div>}
        {data && data.total === 0 && <div className="card pad"><b style={{ fontSize: 15 }}>No annotated reels in {scopeLabel}</b><div className="sub" style={{ marginTop: 6 }}>{organic ? 'Turn off Organic only, or run' : 'Run'} a reference account so its reels are transcribed and annotated.</div></div>}

        {data && data.total > 0 && view === 'list' && (
          <div className="catlist">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
              <div className="sechead" style={{ textTransform: 'none', fontSize: 19, fontWeight: 700, color: 'var(--c-ink)', letterSpacing: '-.02em', padding: '0 4px' }}>
                <span>{PLURAL[a]} <span className="sub" style={{ fontWeight: 500, fontSize: 14 }}>· {groupsA.length} in {data.total.toLocaleString()} reels</span></span>
                <button className="linkbtn" onClick={() => setOrder(order === 'like_rate' ? 'n' : 'like_rate')} title="Change the order">{order === 'like_rate' ? 'median like-rate ↓' : 'most reels ↓'}</button>
              </div>
              <div className="group">
                {[...groupsA].sort((x, y) => order === 'n' ? y.n - x.n : y.like_rate - x.like_rate).map(g => (
                  <button key={g.value} className={'catrow' + (sel?.av === g.value ? ' on' : '')} onClick={() => setSel({ av: g.value, bv: null })}>
                    <span className="fill"><b>{show(a, g.value)}</b><span className="caption">{g.n} reels · {g.accounts} account{g.accounts === 1 ? '' : 's'}</span></span>
                    <span className="catbar"><span style={{ width: Math.min(100, g.like_rate / Math.max(...groupsA.map(x => x.like_rate), 0.01) * 100) + '%', background: lrColor(g.like_rate) }} /></span>
                    <b style={{ width: 52, textAlign: 'right', color: lrColor(g.like_rate) }}>{pct(g.like_rate)}</b>
                  </button>
                ))}
                <div className="caption" style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{hiddenA > 0 ? `${hiddenA} more hidden: under ${min} reels` : `Speciality median ${pct(data.median)}`}</span>
                  {a !== 'language' && <button className="linkbtn" onClick={() => setTidy(true)}>Tidy labels</button>}
                </div>
              </div>
            </div>
            <div className="card" style={{ overflow: 'hidden', minWidth: 0 }}>
              {sel && <>
                <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--c-hair)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}><div style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-.025em' }}>{selName}</div><div style={{ marginTop: 3 }}>{stats(selGroup)}</div></div>
                    {actions}
                  </div>
                  {(() => {
                    const inside = (data.cells || []).filter(c => c.a === sel.av && c.n >= min).sort((x, y) => y.like_rate - x.like_rate)
                    return inside.length > 1 && (
                      <div className="notebox" style={{ gap: 8 }}>
                        <div className="caption" style={{ fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', fontSize: 10.5 }}>Inside it, by {LABEL[b].toLowerCase()} · click one to narrow the reels</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {inside.map(c => <button key={c.b} className={'catchip' + (sel.bv === c.b ? ' on' : '')} onClick={() => setSel({ av: sel.av, bv: sel.bv === c.b ? null : c.b })}>{show(b, c.b)} <b style={{ color: lrColor(c.like_rate) }}>{pct(c.like_rate)}</b><span className="caption">{c.n}</span></button>)}
                          <button className="linkbtn" style={{ fontSize: 12.5, padding: '0 6px' }} onClick={() => { setRowsF(a); setColsF(b); setView('grid') }}>See the grid ›</button>
                        </div>
                      </div>
                    )
                  })()}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="caption">Reels by</span>{sortSeg}<span className="spacer" /><span className="caption">click a reel to open it here</span></div>
                </div>
                {reelList('9px 20px')}
              </>}
            </div>
          </div>
        )}

        {data && data.total > 0 && view === 'grid' && <Grid data={data} a={a} b={b} min={min} sel={sel} setSel={setSel} />}
        {data && data.total > 0 && view === 'grid' && sel && (
          <div className="card combocard" style={{ overflow: 'hidden' }}>
            <div className="combohead"><b style={{ fontSize: 15 }}>{selName}</b>{stats(selGroup)}<span className="spacer" />{sortSeg}{actions}</div>
            {reelList()}
          </div>
        )}

        {data && data.total > 0 && view === 'ranked' && (() => {
          const all = data.cells.filter(c => c.n >= min)
          const worst = all.slice(-3).reverse()
          const top = Math.max(...all.map(c => c.like_rate), 0.01)
          return (
            <>
              <div className="sechead" style={{ textTransform: 'none', fontSize: 19, fontWeight: 700, color: 'var(--c-ink)', letterSpacing: '-.02em', padding: '0 4px' }}>
                <span>Best combinations <span className="sub" style={{ fontWeight: 500, fontSize: 14 }}>· {all.length} {LABEL[a].toLowerCase()} × {LABEL[b].toLowerCase()} pairs with {min}+ {organic ? 'organic ' : ''}reels, by median like-rate</span></span>
              </div>
              <div className="group">
                <div className="rankrow head"><span /><span>Combination</span><span>Median like-rate</span><span /><span>Best hook</span><span /></div>
                {all.length === 0 && <div className="emptyrow">No combination has {min} reels. Lower the minimum.</div>}
                {all.map((c, i) => {
                  const on = sel?.av === c.a && sel?.bv === c.b
                  return (
                    <div key={c.a + '|' + c.b}>
                      <div className={'rankrow' + (on ? ' on' : '')} onClick={() => setSel(on ? null : { av: c.a, bv: c.b })}>
                        <span className="caption" style={{ textAlign: 'right' }}>{i + 1}</span>
                        <span className="fill" style={{ minWidth: 0 }}><b>{show(a, c.a)} <span style={{ color: 'var(--c-muted)', fontWeight: 400 }}>×</span> {show(b, c.b)}</b><span className="caption" style={{ display: 'block' }}>{c.n} reels · {c.accounts} account{c.accounts === 1 ? '' : 's'} · median views {fmt.n(c.views)}</span></span>
                        <span className="catbar"><span style={{ width: Math.min(100, c.like_rate / top * 100) + '%', background: lrColor(c.like_rate) }} /></span>
                        <b style={{ textAlign: 'right', color: lrColor(c.like_rate) }}>{pct(c.like_rate)}</b>
                        <span className="sub" style={{ fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12.5 }}>{c.best.hook}</span>
                        <span style={{ justifySelf: 'end' }}><SendTo codes={[]} load={() => codesOf({ av: c.a, bv: c.b })} onLibrary={toLibrary} label={`Send all ${c.n}`}
                          heading={<>Send all {c.n} reels of <b style={{ color: 'var(--c-ink)' }}>{show(a, c.a)} × {show(b, c.b)}</b> to</>} /></span>
                      </div>
                      {on && <div className="rankopen"><div className="combohead" style={{ borderBottom: '1px solid var(--c-hair)' }}>{sortSeg}<span className="spacer" /><span className="caption">click a reel to open it here</span>{picking && picked.size > 0 && <SendTo codes={[...picked]} onLibrary={toLibrary} label={`Send ${picked.size} selected`} onDone={() => { setPicked(new Set()); setPicking(false) }} />}<button className={'btn plain sm' + (picking ? ' on' : '')} onClick={() => { setPicking(!picking); setPicked(new Set()) }}>{picking ? 'Done' : 'Select'}</button></div>{reelList('8px 18px')}</div>}
                    </div>
                  )
                })}
              </div>
              {all.length > 6 && <div className="card pad" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', padding: '12px 18px' }}>
                <b style={{ color: 'var(--c-red)' }}>Weakest</b>
                {worst.map(c => <span key={c.a + c.b} style={{ fontSize: 12.5 }}>{show(a, c.a)} × {show(b, c.b)} <b style={{ color: 'var(--c-red)' }}>{pct(c.like_rate)}</b> <span className="caption">· {c.n}</span></span>)}
              </div>}
            </>
          )
        })()}
      </div></div>

      {card && open && <ReelPanel list={reels || [open]} sel={open} setSel={setOpen} closing={card === 'closing'} onClose={closeCard} withSide={sideOpen}>
        {header => <Inspector r={open} onEdit={update} target={target} inLib={lib.has(open.shortcode)} onLib={() => toggleLib(open.shortcode)}
          onReplace={nr => { setReels(rs => rs && rs.map(x => x.shortcode === nr.shortcode ? nr : x)); setOpen(o => o?.shortcode === nr.shortcode ? nr : o) }} header={header} />}
      </ReelPanel>}
      {tidy && data && <TidySheet field={a} groups={data.a} speciality={clinic ? null : spec || null} onClose={() => setTidy(false)} onChanged={() => { setSel(null); load() }} />}
    </>
  )
}

/** Two fields crossed: each cell is the median like-rate of that combination, greener above the scope's median. */
function Grid({ data, a, b, min, sel, setSel }: { data: Cats; a: CatField; b: CatField; min: number; sel: Sel | null; setSel: (s: Sel | null) => void }) {
  const [all, setAll] = useState(false)
  const rows = data.a.filter(g => g.n >= min), cols = data.b.filter(g => g.n >= min)
  const R = all ? rows : rows.slice(0, 8), C = all ? cols : cols.slice(0, 8)
  const cell = useMemo(() => { const m = new Map<string, CatCell>(); data.cells.forEach(c => m.set(c.a + '|' + c.b, c)); return m }, [data])
  const med = data.median || 0.5
  const bg = (v: number) => v >= med
    ? `color-mix(in srgb, var(--c-green) ${Math.round(14 + 46 * Math.min(1, (v - med) / (med * 1.2)))}%, transparent)`
    : `color-mix(in srgb, var(--c-red) ${Math.round(7 + 22 * (1 - v / med))}%, transparent)`
  return (
    <>
      <div className="sechead" style={{ textTransform: 'none', fontSize: 19, fontWeight: 700, color: 'var(--c-ink)', letterSpacing: '-.02em', padding: '0 4px' }}>
        <span>{LABEL[a]} × {LABEL[b].toLowerCase()} <span className="sub" style={{ fontWeight: 500, fontSize: 14 }}>· median like-rate of each combination; greener is above the median of {pct(data.median)}. Click a cell to list its reels.</span></span>
        {(rows.length > 8 || cols.length > 8) && <button className="linkbtn" onClick={() => setAll(!all)}>{all ? 'Show the top 8' : `Show all ${rows.length} × ${cols.length}`}</button>}
      </div>
      <div className="card catgridwrap">
        <div className="catgrid" style={{ gridTemplateColumns: `minmax(120px, 190px) repeat(${C.length}, minmax(84px, 1fr))` }}>
          <div />
          {C.map(c => <div key={c.value} className="cathead" title={`${c.n} reels · ${pct(c.like_rate)}`}>{show(b, c.value)}</div>)}
          {R.map(r => [
            <div key={r.value} className="catside" title={`${r.n} reels · ${pct(r.like_rate)}`}>{show(a, r.value)}</div>,
            ...C.map(c => {
              const x = cell.get(r.value + '|' + c.value), on = sel?.av === r.value && sel?.bv === c.value
              if (!x) return <div key={c.value} className="catcell blank" />
              if (x.n < min) return <div key={c.value} className="catcell few">{x.n} · too few</div>
              return <button key={c.value} className={'catcell' + (on ? ' on' : '')} style={{ background: bg(x.like_rate) }} onClick={() => setSel(on ? null : { av: r.value, bv: c.value })}
                title={`${show(a, r.value)} × ${show(b, c.value)}: ${x.n} reels from ${x.accounts} account${x.accounts === 1 ? '' : 's'}`}><b>{pct(x.like_rate)}</b><span>{x.n} reels</span></button>
            }),
          ])}
        </div>
        {(R.length === 0 || C.length === 0) && <div className="emptyrow">Nothing has {min} reels here. Lower the minimum.</div>}
      </div>
    </>
  )
}

/** Rename a label or merge it into another, across the speciality. Fixes labels Claude invented one reel at a time. */
function TidySheet({ field, groups, speciality, onClose, onChanged }: { field: CatField; groups: CatGroup[]; speciality: string | null; onClose: () => void; onChanged: () => void }) {
  const { toast } = useContext(Ui)
  const [busy, setBusy] = useState('')
  const small = [...groups].sort((x, y) => x.n - y.n)
  const big = [...groups].sort((x, y) => y.n - x.n)
  const apply = async (old: string, name: string) => {
    setBusy(old)
    try { const r = await api.categoryRename(field, old, name, speciality); toast(`${r.changed} reel${r.changed === 1 ? '' : 's'} now labelled ${r.new}`); onChanged() }
    catch (e: any) { toast(e.message) } finally { setBusy('') }
  }
  return (
    <Sheet title={`Tidy ${LABEL[field].toLowerCase()} labels`} onClose={onClose} busy={!!busy}>
      <div className="caption" style={{ lineHeight: 1.5 }}>Merge a label into another, or rename it. It changes every reel with that label{speciality ? ` in ${speciality}` : ''}, including ones outside the current filters, and is kept on re-runs.</div>
      <div className="group" style={{ boxShadow: 'none', background: 'var(--c-bg)', maxHeight: 420, overflow: 'auto' }}>
        {small.map(g => (
          <div key={g.value} className="grow" style={{ padding: '8px 14px', gap: 10 }}>
            <div className="fill"><b style={{ fontSize: 13 }}>{g.value}</b><div className="caption">{g.n} reel{g.n === 1 ? '' : 's'} · {pct(g.like_rate)}</div></div>
            <div className="field" style={{ height: 28 }}><select value="" disabled={!!busy} onChange={e => { if (e.target.value) apply(g.value, e.target.value) }} aria-label={`Merge ${g.value} into`} style={{ fontSize: 12 }}>
              <option value="">{busy === g.value ? 'Working…' : 'Merge into…'}</option>
              {big.filter(x => x.value !== g.value).map(x => <option key={x.value} value={x.value}>{x.value} · {x.n}</option>)}
            </select></div>
            <button className="btn plain sm" disabled={!!busy} onClick={() => { const n = window.prompt(`Rename "${g.value}" to`, g.value); if (n && n.trim() && n.trim() !== g.value) apply(g.value, n.trim()) }}>Rename</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={onClose} disabled={!!busy}>Done</button></div>
    </Sheet>
  )
}
