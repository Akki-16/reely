"""Playwright-owned browser: persistent profile, user logs in once, then we read the Reels grid."""
import os
import subprocess
import sys
import time
from pathlib import Path

from config import BROWSER_PROFILE

# Inside the PyInstaller bundle Playwright would look for browsers next to its own driver; point it at
# the standard per-user cache instead so the app shares Chromium with any dev install.
BROWSERS_PATH = Path(os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(Path.home() / "Library" / "Caches" / "ms-playwright")))


def browsers_installed() -> bool:
    return any(p.is_dir() for p in BROWSERS_PATH.glob("chromium-*")) and any(p.is_dir() for p in BROWSERS_PATH.glob("chromium_headless_shell-*"))


def install_browsers(progress=None) -> dict:
    """Download Chromium via Playwright's own driver (works from the frozen bundle too)."""
    from playwright._impl._driver import compute_driver_executable
    node, cli = compute_driver_executable()
    cmd = [str(node), str(cli), "install", "chromium"]
    p = subprocess.run(cmd, capture_output=True, text=True, env=dict(os.environ), timeout=1800)
    ok = p.returncode == 0 and browsers_installed()
    return {"ok": ok, "log": (p.stdout + p.stderr)[-1500:]}

COLLECT_JS = """
() => {
  window.__reels = window.__reels || {};
  for (const a of document.querySelectorAll('a[href*="/reel/"]')) {
    const m = new URL(a.href).pathname.match(/\\/reel\\/([^\\/]+)/);
    if (!m) continue;
    const t = a.innerText.trim();
    if (!window.__reels[m[1]] || t) window.__reels[m[1]] = t;
  }
  window.scrollTo(0, document.body.scrollHeight);
  return Object.keys(window.__reels).length;
}
"""


def _context(playwright, headless=False):
    BROWSER_PROFILE.mkdir(parents=True, exist_ok=True)
    return playwright.chromium.launch_persistent_context(
        str(BROWSER_PROFILE), headless=headless, viewport={"width": 1280, "height": 900},
        args=["--disable-blink-features=AutomationControlled"],
        user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    )


def _logged_in(ctx) -> bool:
    return any(c["name"] == "sessionid" and c["value"] for c in ctx.cookies("https://www.instagram.com"))


def session_status() -> dict:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        ctx = _context(p, headless=True)
        try:
            ok = _logged_in(ctx)
        finally:
            ctx.close()
    return {"logged_in": ok, "profile": str(BROWSER_PROFILE)}


def login_window(timeout_s: int = 600) -> dict:
    """Open a visible window on the Instagram login page; return once a session cookie appears."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        ctx = _context(p)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.instagram.com/accounts/login/", wait_until="domcontentloaded")
        t0 = time.time()
        ok = False
        while time.time() - t0 < timeout_s:
            if _logged_in(ctx):
                ok = True; break
            if not ctx.pages:
                break
            time.sleep(1.5)
        ctx.close()
    return {"logged_in": ok}


def logout() -> dict:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        ctx = _context(p, headless=True)
        ctx.clear_cookies()
        ctx.close()
    return {"logged_in": False}


def scrape_grid(handle: str, pause_ms: int = 1000, max_minutes: int = 40, max_reels: int = 0,
                progress=None, should_stop=lambda: False) -> dict[str, str]:
    """Scroll https://instagram.com/<handle>/reels/ collecting {shortcode: views_text}.
    max_reels > 0 stops once that many tiles (newest first) have been collected."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        ctx = _context(p)
        try:
            if not _logged_in(ctx):
                raise RuntimeError("Browser is not logged in to Instagram. Use Models → Scraping browser → Open window to log in.")
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(f"https://www.instagram.com/{handle}/reels/", wait_until="domcontentloaded")
            page.wait_for_timeout(3000)
            if page.locator('text="Sorry, this page isn\'t available."').count():
                raise RuntimeError(f"@{handle} does not exist or is private.")
            last, stable, t0 = -1, 0, time.time()
            while time.time() - t0 < max_minutes * 60 and not should_stop():
                n = page.evaluate(COLLECT_JS)
                if max_reels and n >= max_reels:
                    if progress: progress(n, None, f"{n} reels collected · limit reached")
                    break
                if n == last:
                    stable += 1
                    if stable >= 12:
                        break
                else:
                    stable, last = 0, n
                if progress: progress(n, None, f"{n} reels collected")
                page.wait_for_timeout(pause_ms)
            reels = page.evaluate("() => window.__reels")
        finally:
            ctx.close()
    return reels
