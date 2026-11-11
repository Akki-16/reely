import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { setBase } from './api'
import './styles.css'

export const isTauri = '__TAURI_INTERNALS__' in window

async function boot() {
  if (isTauri) {
    document.documentElement.dataset.shell = 'tauri'
    const { invoke } = await import('@tauri-apps/api/core')
    // The Rust side spawns the backend and tells us where it listens.
    for (let i = 0; i < 120; i++) {
      try { setBase(await invoke<string>('backend_url')); break }
      catch (e) { if (i === 119) { document.body.innerHTML = `<div style="font:14px -apple-system;padding:40px;color:#D70015">Reely could not start its backend.<br><br>${String(e)}</div>`; return } await new Promise(r => setTimeout(r, 500)) }
    }
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  )
}
boot()
