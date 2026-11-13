export type Clinic = {
  handle: string; display_name: string | null; followers: number | null
  reels_total: number; analysed: number; median_views: number | null; top_views: number | null
  median_like_rate: number | null; last_run: string | null; status: string; speciality: string | null; downloaded?: number; remaining?: number
  missing_videos?: number; video_job?: { status: string; done: number; total: number | null; note: string; ok: number; failed: number } | null
  failed?: number; pending?: number; waiting?: string | null; run_id?: number
  imported?: { from: string; at: string; videos: boolean; transcripts: boolean; insights: boolean; chat: boolean } | null
}
export type Reel = {
  shortcode: string; clinic: string; speciality: string | null; rank: number; file_name: string; url: string
  views: number; likes: number; like_rate: number | null; outlier: number | null
  date: string; duration: number | null; language: string | null
  hook_en: string; hook_type: string; format: string; cta: string; flag: string; summary: string
  hook_original: string; caption: string; transcript: string; transcript_en: string; video_file: string; edited: number
}
export type Stage = { status: string; done?: number; total?: number | null; note?: string; seconds?: number; extra?: any }
export type Run = {
  id: number; clinic: string; started: string; finished: string | null; status: string
  stage: string | null; stages: Record<string, Stage>; settings: Record<string, string>; log: string; error: string | null
}
export type Model = {
  id: string; repo: string; engine: string; file?: string; url?: string; size_mb: number; speed: string; best_for: string; installed: boolean
  note?: string; translate_fallbacks?: string[]
  size_on_disk: number; download: { status: string; bytes: number; total: number; error: string | null } | null
}
export type ModelNotes = { families: string; measured: string; backups: string; cpu_rows: string }
export type Engine = { id: string; name: string; device: string; desc: string; available: boolean }

export type Person = { id: string; name: string; role?: string; languages?: string[]; on_camera?: string; note?: string; lead?: boolean; branches?: string[] }
export type Branch = { id: string; name: string; area?: string; services?: string; cta?: string; maps?: string; reviews?: string; main?: boolean }
export type Source = { id: string; kind: 'website' | 'social' | 'listing' | 'file' | 'note' | 'custom'; label: string; value: string; person_id?: string | null; branch_id?: string | null; status?: string; detail?: string; read_at?: string; size?: number }
export type Brief = Record<string, any>
export type BriefMeta = { drafted_at?: string; sources?: number; edited?: string[]; version?: number; locked?: boolean; history?: { at: string; what: string }[] }
export type ClientJob = { kind?: string; section?: string; status: string; note?: string; error?: string | null } | null
export type ClientDoc = {
  id: number; name: string; speciality: string | null; city: string | null; languages: string[]; color: string | null; image?: string | null
  people: Person[]; branches: Branch[]; sources: Source[]; brief: Brief | null; brief_meta: BriefMeta; job?: ClientJob; created_at: string; updated_at: string
}
export type ClientSummary = { id: number; name: string; speciality: string | null; city: string | null; languages: string[]; color: string | null; image?: string | null; lead: string | null; people: number; branches: number; has_brief: boolean; brief_locked: boolean; refs: number; scripts: number; writing: number; review: number; updated_at: string }
export type ScriptLine = { t?: string; who?: string; line?: string; romanised?: string; english?: string; visual?: string }
export type ScriptData = {
  title?: string; topic?: string; borrowed?: string; duration_s?: number; on_camera?: string[]
  hooks?: { line?: string; romanised?: string; english?: string; why?: string }[]; hook_pick?: number
  beats?: ScriptLine[]; caption?: string; hashtags?: string[]; cta?: string
  claims?: { claim?: string; check?: string }[]; checked?: number[]; compliance?: { ok?: boolean; note?: string }[]; notes?: string; pattern?: string
}
export type Pattern = { id: string; name: string; description?: string; hook_style?: string; structure?: string; length_s?: number; on_camera?: string; works_because?: string; good_for?: string; examples?: string[]; example_hooks?: string[]; accounts?: string[]; median_like_rate?: number | null; count?: number }
export type PlanItem = { id: string; topic: string; angle?: string; pattern_id?: string; pattern?: string; language: string; person_id?: string | null; on_camera?: string; refs?: string[]; why?: string; ok?: boolean; warn?: string; tick?: boolean; script_id?: number | null; script_status?: string; script_title?: string }
export type Plan = { id: number; client_id: number; month: string; count: number; status: string; note?: string; error?: string | null; items: PlanItem[]; settings: { mix?: Record<string, number>; cast?: string; note?: string }; created_at: string }
export type Script = { id: number; client_id: number; plan_id?: number | null; pattern?: string; shortcode: string | null; person_id: string | null; language: string; status: string; title: string; error: string | null; created_at: string; updated_at: string; options: any; data: ScriptData | null; hook?: string; duration_s?: number; ref_hook?: string; ref_clinic?: string; ref_like_rate?: number; ref?: RefReel | null }
export type ClientEstimate = { name: string; speciality: string | null; people: number; branches: number; sources: number; has_brief: boolean; plans: number; scripts: number; core: number; files: number; files_n: number; refs_n: number; ref_accounts: string[]; ref_reels_size: number; ref_videos: number; ref_videos_n: number; ref_by_account: Record<string, { n: number; videos: number; videos_n: number }> }
export type CatField = 'format' | 'hook_type' | 'flag' | 'language'
export type CatGroup = { value: string; n: number; like_rate: number; views: number; accounts: number; best: { hook: string; like_rate: number; clinic: string } }
export type CatCell = Omit<CatGroup, 'value'> & { a: string; b: string }
export type Categories = { total: number; median: number | null; a: CatGroup[]; b: CatGroup[]; cells: CatCell[] }
export type RefReel = { video_url?: string; imported_ref?: boolean; shortcode: string; clinic?: string; url: string; hook_en?: string; hook_original?: string; format?: string; hook_type?: string; language?: string; duration?: number; views?: number; likes?: number; like_rate?: number; summary?: string; video_file?: string; date?: string; missing?: boolean }

/** Backend origin. Empty in the browser (same origin); set by main.tsx inside the Tauri shell. */
export let BASE = ''
export function setBase(u: string) { BASE = u.replace(/\/$/, '') }
export const url = (path: string) => BASE + path
export const isTauri = '__TAURI_INTERNALS__' in window

/** Open a link outside the app. The Tauri webview ignores target=_blank, so route through the opener plugin there. */
export async function openExternal(u: string) {
  if (isTauri) { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(u) }
  else window.open(u, '_blank', 'noreferrer')
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail || r.statusText)
  return r.json()
}

export const api = {
  overview: () => j<any>('/api/overview'),
  addClinic: (handle: string, speciality: string | null, settings: Record<string, string> = {}) =>
    j<{ handle: string; run_id: number | null }>('/api/clinics', { method: 'POST', body: JSON.stringify({ handle, run: true, settings, speciality }) }),
  editClinic: (h: string, data: { speciality?: string | null; display_name?: string }) => j<Clinic>(`/api/clinics/${h}`, { method: 'PATCH', body: JSON.stringify(data) }),
  exportSave: (h: string, params: Record<string, string>) => j<{ path: string; rows: number }>(`/api/clinics/${h}/export?` + new URLSearchParams(params), { method: 'POST' }),
  deleteClinic: (h: string, files = false) => j(`/api/clinics/${h}?files=${files ? 'true' : 'false'}`, { method: 'DELETE' }),
  reimport: (h: string) => j(`/api/clinics/${h}/import`, { method: 'POST' }),
  startRun: (h: string, settings: Record<string, string> = {}) => j<{ run_id: number }>(`/api/clinics/${h}/run`, { method: 'POST', body: JSON.stringify({ settings }) }),
  more: (h: string, count: number | null) => j<{ run_id: number; top_n: number }>(`/api/clinics/${h}/more`, { method: 'POST', body: JSON.stringify({ count }) }),
  clinicVideos: (h: string, count: number | null) => j<any>(`/api/clinics/${h}/videos`, { method: 'POST', body: JSON.stringify({ count }) }),
  clinicVideosStop: (h: string) => j<any>(`/api/clinics/${h}/videos/stop`, { method: 'POST' }),
  runs: (limit = 200) => j<Run[]>(`/api/runs?limit=${limit}`),
  queueAdd: (handles: string[], speciality: string | null) => j<{ added: any[] }>('/api/queue', { method: 'POST', body: JSON.stringify({ handles, speciality }) }),
  queue: () => j<{ items: any[]; lanes: Record<string, { holder: string | null; waiting: number }> }>('/api/queue'),
  moveRun: (id: number, direction: number) => j(`/api/runs/${id}/move`, { method: 'POST', body: JSON.stringify({ direction }) }),
  failures: (h: string) => j<any[]>(`/api/clinics/${h}/failures`),
  retry: (h: string) => j<{ run_id: number }>(`/api/clinics/${h}/retry`, { method: 'POST' }),
  ignoreFailures: (h: string, codes: string[], value: boolean) => j(`/api/clinics/${h}/failures/ignore`, { method: 'POST', body: JSON.stringify({ codes, value }) }),
  refreshStats: (h: string) => j<{ run_id: number }>(`/api/clinics/${h}/refresh`, { method: 'POST' }),
  reelHistory: (code: string) => j<{ at: string; views: number | null; likes: number | null }[]>(`/api/reels/${code}/history`),
  storage: () => j<{ clinics: any[]; auto_clear_videos: boolean }>('/api/storage'),
  clearData: (h: string, what: 'processed' | 'videos' | 'temp') => j<{ removed: number; bytes: number }>(`/api/clinics/${h}/clear`, { method: 'POST', body: JSON.stringify({ what }) }),
  library: () => j<any[]>('/api/library'),
  libraryAdd: (codes: string[]) => j<{ added: string[] }>('/api/library', { method: 'POST', body: JSON.stringify({ codes }) }),
  libraryRemove: (codes: string[]) => j<{ removed: number }>('/api/library/remove', { method: 'POST', body: JSON.stringify({ codes }) }),
  libraryNote: (code: string, note: string) => j(`/api/library/${code}`, { method: 'PUT', body: JSON.stringify({ note }) }),
  libraryExportSave: (fmt: 'csv' | 'md') => j<{ path: string }>(`/api/library/export?fmt=${fmt}`, { method: 'POST' }),
  hooks: (params: Record<string, string>) => j<{ hooks: any[]; facets: Record<string, string[]> }>('/api/hooks?' + new URLSearchParams(params)),
  report: (spec: string | null) => j<any>('/api/reports' + (spec ? '?speciality=' + encodeURIComponent(spec) : '')),
  reportGenerate: (spec: string | null) => j<any>('/api/reports', { method: 'POST', body: JSON.stringify({ speciality: spec }) }),
  transferEstimate: (handles: string[]) => j<any>('/api/transfer/estimate?handles=' + encodeURIComponent(handles.join(','))),
  transferExport: (handles: string[], include: Record<string, boolean>, clients: number[] = [], ref_mode: 'reels' | 'none' = 'reels') => j<any>('/api/transfer/export', { method: 'POST', body: JSON.stringify({ handles, include, clients, ref_mode }) }),
  transferEstimateClients: (ids: number[]) => j<Record<string, ClientEstimate>>('/api/transfer/estimate-clients?ids=' + ids.join(',')),
  transferInspect: (path: string) => j<any>('/api/transfer/inspect', { method: 'POST', body: JSON.stringify({ path }) }),
  transferImport: (path: string, handles: string[], mode: string, clients?: string[]) => j<any>('/api/transfer/import', { method: 'POST', body: JSON.stringify({ path, handles, mode, clients }) }),
  transferJob: () => j<any>('/api/transfer/job'),
  reelOne: (code: string) => j<Reel>(`/api/reels/${code}`),
  reelDownload: (code: string) => j<{ status: string; error: string | null }>(`/api/reels/${code}/download`, { method: 'POST' }),
  reelDownloadStatus: (code: string) => j<{ status: string; error: string | null }>(`/api/reels/${code}/download`),
  run: (id: number) => j<Run>(`/api/runs/${id}`),
  runAction: (id: number, a: 'pause' | 'resume' | 'stop' | 'skip') => j(`/api/runs/${id}/${a}`, { method: 'POST' }),
  reels: (h: string, params: Record<string, string>) => j<{ reels: Reel[]; facets: Record<string, string[]>; total: number }>(`/api/clinics/${h}/reels?` + new URLSearchParams(params)),
  recheckCount: (h: string) => j<{ count: number; with_video: number }>(`/api/clinics/${h}/recheck`),
  recheck: (h: string) => j<{ run_id: number }>(`/api/clinics/${h}/recheck`, { method: 'POST' }),
  reelRetranscribe: (code: string) => j<{ status: string; error: string | null; changed: boolean }>(`/api/reels/${code}/retranscribe`, { method: 'POST' }),
  reelRetranscribeStatus: (code: string) => j<{ status: string; error?: string | null; changed?: boolean }>(`/api/reels/${code}/retranscribe`),
  reelTranscript: (code: string) => j<any>(`/api/reels/${code}/transcript`),
  reelTranslate: (code: string, to: string) => j<any>(`/api/reels/${code}/translate`, { method: 'POST', body: JSON.stringify({ to }) }),
  editReel: (code: string, data: Partial<Reel>) => j<Reel>(`/api/reels/${code}`, { method: 'PATCH', body: JSON.stringify(data) }),
  translate: (h: string) => j<any>(`/api/clinics/${h}/translate`, { method: 'POST' }),
  translateStatus: (h: string) => j<{ missing: number; job: { status: string; done: number; total: number | null; note: string } | null; target: string }>(`/api/clinics/${h}/translate/status`),
  insights: (h: string, params: Record<string, string> = {}) => j<{ stats: any; markdown: string | null }>(`/api/clinics/${h}/insights?` + new URLSearchParams(params)),
  chat: (h: string) => j<{ role: string; text: string; at: string }[]>(`/api/clinics/${h}/chat`),
  clearChat: (h: string) => j(`/api/clinics/${h}/chat`, { method: 'DELETE' }),
  ask: (h: string, question: string) => j<any>(`/api/clinics/${h}/ask`, { method: 'POST', body: JSON.stringify({ question }) }),
  askStatus: (h: string) => j<{ status: string; elapsed?: number; answer?: string; error?: string }>(`/api/clinics/${h}/ask/status`),
  models: () => j<{ models: Model[]; cache: { bytes: number; path: string; ggml_path: string }; engines: Engine[]; notes: ModelNotes; default: string; engine: string }>('/api/models'),
  downloadModel: (id: string) => j(`/api/models/${id}/download`, { method: 'POST' }),
  deleteModel: (id: string) => j(`/api/models/${id}`, { method: 'DELETE' }),
  tools: () => j<any>('/api/tools'),
  browserStatus: () => j<{ logged_in: boolean; error?: string }>('/api/browser/status'),
  browserLogin: () => j<any>('/api/browser/login', { method: 'POST' }),
  browserLoginResult: () => j<{ open: boolean; result: any }>('/api/browser/login/result'),
  browserLogout: () => j('/api/browser/logout', { method: 'POST' }),
  browserInstall: () => j<any>('/api/browser/install', { method: 'POST' }),
  browserInstallStatus: () => j<{ running: boolean; result: { ok: boolean; log: string } | null; installed: boolean }>('/api/browser/install/status'),
  settings: () => j<Record<string, string>>('/api/settings'),
  putSettings: (values: Record<string, string>) => j<Record<string, string>>('/api/settings', { method: 'PUT', body: JSON.stringify({ values }) }),
  clients: () => j<ClientSummary[]>('/api/clients'),
  clientNew: (data: { name: string; speciality?: string | null; city?: string | null; languages?: string[] }) => j<ClientDoc>('/api/clients', { method: 'POST', body: JSON.stringify(data) }),
  client: (id: number) => j<ClientDoc>(`/api/clients/${id}`),
  clientEdit: (id: number, data: Partial<ClientDoc>) => j<ClientDoc>(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  clientDelete: (id: number) => j(`/api/clients/${id}`, { method: 'DELETE' }),
  clientFiles: (id: number, paths: string[], person_id?: string | null) => j<ClientDoc>(`/api/clients/${id}/files`, { method: 'POST', body: JSON.stringify({ paths, person_id }) }),
  clientImage: (id: number, path: string) => j<ClientDoc>(`/api/clients/${id}/image`, { method: 'POST', body: JSON.stringify({ path }) }),
  clientImageRemove: (id: number) => j<ClientDoc>(`/api/clients/${id}/image`, { method: 'DELETE' }),
  clientRead: (id: number, source_id?: string) => j(`/api/clients/${id}/read`, { method: 'POST', body: JSON.stringify({ source_id }) }),
  briefDraft: (id: number) => j(`/api/clients/${id}/brief/draft`, { method: 'POST' }),
  briefRedraft: (id: number, section: string, ask = '') => j(`/api/clients/${id}/brief/redraft`, { method: 'POST', body: JSON.stringify({ section, ask }) }),
  briefSave: (id: number, data: { brief?: Brief; section?: string; locked?: boolean }) => j<ClientDoc>(`/api/clients/${id}/brief`, { method: 'PUT', body: JSON.stringify(data) }),
  briefPdf: (id: number) => j<{ path: string; pdf: boolean; note?: string }>(`/api/clients/${id}/brief/pdf`, { method: 'POST' }),
  clientRefs: (id: number) => j<(Reel & { added: string; note: string; scripts: number })[]>(`/api/clients/${id}/refs`),
  clientRefsAdd: (id: number, codes: string[]) => j<{ added: string[] }>(`/api/clients/${id}/refs`, { method: 'POST', body: JSON.stringify({ codes }) }),
  clientRefsRemove: (id: number, codes: string[]) => j(`/api/clients/${id}/refs/remove`, { method: 'POST', body: JSON.stringify({ codes }) }),
  sendCheck: (codes: string[]) => j<Record<string, number>>('/api/send-to/check', { method: 'POST', body: JSON.stringify({ codes }) }),
  scripts: (id: number) => j<Script[]>(`/api/clients/${id}/scripts`),
  scriptNew: (id: number, data: { topic?: string; shortcode?: string | null; person_id?: string | null; language: string; closeness: string; cast?: string; note?: string }) => j<{ id: number }>(`/api/clients/${id}/scripts`, { method: 'POST', body: JSON.stringify(data) }),
  script: (sid: number) => j<Script>(`/api/scripts/${sid}`),
  scriptEdit: (sid: number, data: { data?: ScriptData; status?: string; title?: string }) => j<Script>(`/api/scripts/${sid}`, { method: 'PATCH', body: JSON.stringify(data) }),
  scriptRetry: (sid: number) => j(`/api/scripts/${sid}/retry`, { method: 'POST' }),
  scriptDelete: (sid: number) => j(`/api/scripts/${sid}`, { method: 'DELETE' }),
  categories: (p: Record<string, string>) => j<Categories>('/api/categories?' + new URLSearchParams(p)),
  categoryReels: (p: Record<string, string>) => j<{ reels: Reel[] }>('/api/categories/reels?' + new URLSearchParams(p)),
  categoryRename: (field: string, old: string, name: string, speciality: string | null) => j<{ changed: number; new: string }>('/api/categories/rename', { method: 'POST', body: JSON.stringify({ field, old, new: name, speciality }) }),
  patterns: (speciality: string | null) => j<{ patterns: Pattern[]; reels: number; made_at: string | null; job: { status: string; note?: string; error?: string | null } | null; available: number }>('/api/patterns' + (speciality ? '?speciality=' + encodeURIComponent(speciality) : '')),
  patternsMine: (speciality: string | null) => j('/api/patterns/mine', { method: 'POST', body: JSON.stringify({ speciality }) }),
  plans: (id: number) => j<Plan[]>(`/api/clients/${id}/plans`),
  planNew: (id: number, data: { month: string; count: number; mix: Record<string, number>; cast?: string; note?: string }) => j<Plan>(`/api/clients/${id}/plans`, { method: 'POST', body: JSON.stringify(data) }),
  planEdit: (pid: number, items: PlanItem[]) => j<Plan>(`/api/plans/${pid}`, { method: 'PATCH', body: JSON.stringify({ items }) }),
  planRetry: (pid: number) => j(`/api/plans/${pid}/retry`, { method: 'POST' }),
  planDelete: (pid: number) => j(`/api/plans/${pid}`, { method: 'DELETE' }),
  planGenerate: (pid: number) => j<{ queued: number }>(`/api/plans/${pid}/generate`, { method: 'POST' }),
  scriptPdf: (sid: number, ref = false) => j<{ path: string; pdf: boolean; note?: string }>(`/api/scripts/${sid}/pdf?ref=${ref}`, { method: 'POST' }),
  reveal: (path = '') => j('/api/reveal?path=' + encodeURIComponent(path), { method: 'POST' }),
}

/** URL of a client's picture, or null when it has none. */
export const clientImage = (c: { id: number; image?: string | null }) => c.image ? url(`/api/clients/${c.id}/image/${encodeURIComponent(c.image)}`) : null

export const fmt = {
  /** Short counts for views and likes: 28m, 6.8m, 355k, 23.9k, 157. */
  n: (v: number | null | undefined) => {
    if (v == null) return '—'
    const s = (x: number, d: number) => x.toFixed(d).replace(/\.0$/, '')
    return v >= 1e6 ? s(v / 1e6, v >= 1e7 ? 0 : 1) + 'm' : v >= 1e3 ? s(v / 1e3, v >= 1e5 ? 0 : 1) + 'k' : String(Math.round(v))
  },
  pct: (v: number | null | undefined) => v == null ? '—' : v.toFixed(2) + '%',
  bytes: (b: number) => b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(0) + ' MB' : b > 0 ? Math.max(1, Math.round(b / 1e3)) + ' KB' : '0 KB',
  dur: (s: number | null | undefined) => s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`,
  date: (d: string | null | undefined) => d ? new Date(d.replace(' ', 'T')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.length > 10 ? undefined : 'numeric' }) : '—',
  time: (d: string | null | undefined) => d ? d.slice(11, 16) : '',
}

export const LANGS: Record<string, string> = { en: 'English', hi: 'Hindi', te: 'Telugu', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', gu: 'Gujarati', bn: 'Bengali', pa: 'Punjabi', ur: 'Urdu', or: 'Odia', as: 'Assamese', ne: 'Nepali' }
export const langName = (l: string | null | undefined) => l ? (LANGS[l] || l) : ''

export function lrColor(v: number | null | undefined) {
  if (v == null) return 'var(--c-muted)'
  if (v >= 0.25) return 'var(--c-green)'
  if (v >= 0.1) return 'var(--c-amber)'
  return 'var(--c-red)'
}
