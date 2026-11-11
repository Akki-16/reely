"""SQLite store. Disk files (CSV/JSON in each clinic folder) stay the source of truth
for the pipeline; the DB is the index the UI reads and the place user edits land."""
import json
import sqlite3
import threading
from contextlib import contextmanager

from config import DB_PATH, DEFAULTS, KNOWN_SPECIALITIES

_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS clinics (
  handle TEXT PRIMARY KEY,
  display_name TEXT, followers INTEGER,
  reels_total INTEGER DEFAULT 0, analysed INTEGER DEFAULT 0,
  median_views REAL, top_views INTEGER, median_like_rate REAL,
  last_run TEXT, status TEXT DEFAULT 'not_run',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reels (
  shortcode TEXT PRIMARY KEY,
  clinic TEXT NOT NULL,
  rank INTEGER, file_name TEXT, url TEXT,
  views INTEGER, likes INTEGER, like_rate REAL, outlier REAL,
  date TEXT, duration REAL, language TEXT,
  hook_en TEXT, hook_type TEXT, format TEXT, cta TEXT, flag TEXT, summary TEXT,
  hook_original TEXT, caption TEXT, transcript TEXT, transcript_en TEXT,
  video_file TEXT, edited INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS reels_clinic ON reels(clinic);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic TEXT NOT NULL,
  started TEXT DEFAULT (datetime('now')), finished TEXT,
  status TEXT DEFAULT 'queued',     -- queued | running | paused | done | failed | stopped
  stage TEXT, stages TEXT,          -- stages: JSON {name: {status, done, total, note, seconds}}
  settings TEXT, log TEXT DEFAULT '', error TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic TEXT, role TEXT, text TEXT, session_id TEXT,
  at TEXT DEFAULT (datetime('now'))
);
"""


def connect():
    con = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    return con


_con = None


def con():
    global _con
    if _con is None:
        _con = connect()
        with _lock:
            _con.executescript(SCHEMA)
            _migrate(_con)
            for k, v in DEFAULTS.items():
                _con.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (k, v))
            _con.commit()
    return _con


def _migrate(c):
    """Additive schema changes for databases created by earlier versions."""
    cols = {r[1] for r in c.execute("PRAGMA table_info(clinics)")}
    if "speciality" not in cols:
        c.execute("ALTER TABLE clinics ADD COLUMN speciality TEXT")
        for handle, sp in KNOWN_SPECIALITIES.items():
            c.execute("UPDATE clinics SET speciality=? WHERE handle=? AND speciality IS NULL", (sp, handle))


@contextmanager
def tx():
    with _lock:
        c = con()
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise


def rows(sql, params=()):
    with _lock:
        return [dict(r) for r in con().execute(sql, params).fetchall()]


def one(sql, params=()):
    r = rows(sql, params)
    return r[0] if r else None


def get_settings():
    return {r["key"]: r["value"] for r in rows("SELECT key,value FROM settings")}


def set_setting(key, value):
    with tx() as c:
        c.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))


def upsert(table, data: dict, key: str):
    cols = list(data.keys())
    sets = ", ".join(f"{c}=excluded.{c}" for c in cols if c != key)
    sql = f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join('?' * len(cols))}) ON CONFLICT({key}) DO UPDATE SET {sets}"
    with tx() as c:
        c.execute(sql, [json.dumps(v) if isinstance(v, (dict, list)) else v for v in data.values()])
