export type Clinic = {
  handle: string; display_name: string | null; followers: number | null
  reels_total: number; analysed: number; median_views: number | null; top_views: number | null
  median_like_rate: number | null; last_run: string | null; status: string; speciality: string | null; downloaded?: number; remaining?: number
  failed?: number; waiting?: string | null; run_id?: number
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
  runs: () => j<Run[]>('/api/runs'),
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
  transferExport: (handles: string[], include: Record<string, boolean>) => j<any>('/api/transfer/export', { method: 'POST', body: JSON.stringify({ handles, include }) }),
  transferInspect: (path: string) => j<any>('/api/transfer/inspect', { method: 'POST', body: JSON.stringify({ path }) }),
  transferImport: (path: string, handles: string[], mode: string) => j<any>('/api/transfer/import', { method: 'POST', body: JSON.stringify({ path, handles, mode }) }),
  transferJob: () => j<any>('/api/transfer/job'),
  reelOne: (code: string) => j<Reel>(`/api/reels/${code}`),
  reelDownload: (code: string) => j<{ status: string; error: string | null }>(`/api/reels/${code}/download`, { method: 'POST' }),
  reelDownloadStatus: (code: string) => j<{ status: string; error: string | null }>(`/api/reels/${code}/download`),
  run: (id: number) => j<Run>(`/api/runs/${id}`),
  runAction: (id: number, a: 'pause' | 'resume' | 'stop' | 'skip') => j(`/api/runs/${id}/${a}`, { method: 'POST' }),
  reels: (h: string, params: Record<string, string>) => j<{ reels: Reel[]; facets: Record<string, string[]>; total: number }>(`/api/clinics/${h}/reels?` + new URLSearchParams(params)),
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
  reveal: (path = '') => j('/api/reveal?path=' + encodeURIComponent(path), { method: 'POST' }),
}

export const fmt = {
  n: (v: number | null | undefined) => v == null ? '—' : v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'K' : String(v),
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
