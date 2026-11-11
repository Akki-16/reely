"""Claude Code CLI adapter: runs `claude -p` on the user's subscription."""
import json
import shutil
import subprocess
from pathlib import Path


def find() -> str | None:
    for cand in ("claude", "/usr/local/bin/claude", "/opt/homebrew/bin/claude", str(Path.home() / ".local/bin/claude")):
        p = shutil.which(cand) or (cand if Path(cand).exists() else None)
        if p:
            return p
    return None


def status() -> dict:
    path = find()
    if not path:
        return {"installed": False, "path": None, "version": None, "logged_in": False}
    try:
        v = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        v = None
    return {"installed": True, "path": path, "version": v, "logged_in": v is not None}


def run(prompt: str, cwd: Path | None = None, json_out: bool = True, session_id: str | None = None,
        timeout_s: int = 1800) -> dict:
    """Run one non-interactive Claude call. Returns {text, session_id, raw}."""
    path = find()
    if not path:
        raise RuntimeError("Claude Code CLI is not installed. Install with: npm install -g @anthropic-ai/claude-code")
    # Read-only tools pre-approved so a headless call can read the clinic folder without an
    # interactive permission prompt (which would otherwise silently block it).
    cmd = [path, "-p", prompt, "--allowedTools", "Read,Glob,Grep"]
    if json_out:
        cmd += ["--output-format", "json"]
    if session_id:
        cmd += ["--resume", session_id]
    p = subprocess.run(cmd, cwd=str(cwd) if cwd else None, capture_output=True, text=True, timeout=timeout_s)
    if p.returncode != 0:
        raise RuntimeError(f"claude exited {p.returncode}: {p.stderr.strip()[-500:]}")
    out = p.stdout.strip()
    if json_out:
        try:
            d = json.loads(out)
            return {"text": d.get("result", ""), "session_id": d.get("session_id"), "raw": d}
        except json.JSONDecodeError:
            pass
    return {"text": out, "session_id": None, "raw": out}


def extract_json(text: str):
    """Pull the first JSON object/array out of a model reply (handles ```json fences)."""
    s = text.strip()
    if "```" in s:
        parts = s.split("```")
        for part in parts[1::2]:
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            try:
                return json.loads(part)
            except json.JSONDecodeError:
                continue
    start = min([i for i in (s.find("{"), s.find("[")) if i >= 0], default=-1)
    if start < 0:
        raise ValueError("no JSON in reply")
    for end in range(len(s), start, -1):
        try:
            return json.loads(s[start:end])
        except json.JSONDecodeError:
            continue
    raise ValueError("could not parse JSON from reply")
