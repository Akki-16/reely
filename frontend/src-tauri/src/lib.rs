//! Reely shell: spawns the bundled Python backend (PyInstaller one-folder build shipped as a
//! resource), waits for its READY line, and hands the URL to the web UI.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, State};

struct Backend {
    url: Mutex<Option<String>>,
    child: Mutex<Option<Child>>,
    error: Mutex<Option<String>>,
}

#[tauri::command]
fn backend_url(state: State<Backend>) -> Result<String, String> {
    if let Some(u) = state.url.lock().unwrap().clone() {
        return Ok(u);
    }
    Err(state.error.lock().unwrap().clone().unwrap_or_else(|| "backend not ready".into()))
}

fn spawn_backend(app: &tauri::AppHandle) -> Result<(String, Child), String> {
    // Dev override: point the shell at an already-running backend.
    if let Ok(u) = std::env::var("REELY_BACKEND_URL") {
        let dummy = Command::new("true").spawn().map_err(|e| e.to_string())?;
        return Ok((u, dummy));
    }
    let res = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource dir: {e}"))?;
    let exe = res.join("backend").join("reely-backend").join("reely-backend");
    if !exe.exists() {
        return Err(format!("backend binary missing at {}", exe.display()));
    }
    let mut child = Command::new(&exe)
        .arg("--port").arg("0")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("spawn backend: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut reader = BufReader::new(stdout);
    let start = Instant::now();
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("backend exited before READY".into());
        }
        if let Some(port) = line.trim().strip_prefix("READY ") {
            let url = format!("http://127.0.0.1:{}", port.trim());
            // keep draining stdout in the background so the child never blocks on a full pipe
            std::thread::spawn(move || { let mut s = String::new(); while let Ok(n) = reader.read_line(&mut s) { if n == 0 { break } s.clear(); } });
            return Ok((url, child));
        }
        if start.elapsed() > Duration::from_secs(90) {
            return Err("backend took too long to start".into());
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Backend { url: Mutex::new(None), child: Mutex::new(None), error: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![backend_url])
        .setup(|app| {
            let handle = app.handle().clone();
            let state: State<Backend> = app.state();
            match spawn_backend(&handle) {
                Ok((url, child)) => {
                    *state.url.lock().unwrap() = Some(url);
                    *state.child.lock().unwrap() = Some(child);
                }
                Err(e) => {
                    eprintln!("Reely: {e}");
                    *state.error.lock().unwrap() = Some(e);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Reely")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<Backend>().child.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
