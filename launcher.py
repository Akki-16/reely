"""Reel Research — native Mac window around the local server.

Starts uvicorn on a free localhost port in a background thread, then opens a pywebview
window on it. Closing the window stops the server.
"""
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))


def free_port(preferred=8765) -> int:
    for p in (preferred, 0):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return s.getsockname()[1]
            except OSError:
                continue
    return 0


def serve(port: int):
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=port, log_level="warning", app_dir=str(ROOT / "backend"))


def wait_ready(url: str, timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            urllib.request.urlopen(url + "/api/settings", timeout=1)
            return True
        except Exception:
            time.sleep(0.3)
    return False


def main():
    port = free_port()
    url = f"http://127.0.0.1:{port}"
    threading.Thread(target=serve, args=(port,), daemon=True).start()
    wait_ready(url)
    if "--browser" in sys.argv:
        import webbrowser
        webbrowser.open(url)
        print(f"Reel Research running at {url}  (Ctrl-C to stop)")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return
    import webview

    class WindowApi:
        """Called from the sidebar's traffic lights (window.pywebview.api.*)."""
        def close(self):
            webview.windows[0].destroy()

        def minimize(self):
            webview.windows[0].minimize()

        def zoom(self):
            w = webview.windows[0]
            w.toggle_fullscreen()

    # Frameless: the UI draws the traffic lights inside the sidebar (Apple-style mock) and marks
    # the sidebar/toolbar as drag regions, so there is no second system title bar.
    webview.create_window("Reel Research", url, width=1280, height=820, min_size=(960, 640),
                          frameless=True, easy_drag=False, background_color="#F5F5F7",
                          text_select=True, js_api=WindowApi())
    webview.start()


if __name__ == "__main__":
    main()
