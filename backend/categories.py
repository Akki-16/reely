"""Categories: how the annotated reels of a speciality split by format, hook type, flag or language, alone or crossed
two at a time, with the median like-rate of each group. Also renames or merges a label across a speciality."""
import json
import statistics

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import db
from config import DATA_ROOT, LANG_NAMES

router = APIRouter()
FIELDS = ("format", "hook_type", "flag", "language")


def _val(r: dict, field: str) -> str:
    # flags carry notes after a semicolon ("organic; duplicate repost of X"); the category is the first part
    return (r.get(field) or "").split(";")[0].strip()


def _rows(speciality: str | None, clinic: str | None, organic: bool) -> list[dict]:
    sql = ("SELECT r.*, c.speciality FROM reels r LEFT JOIN clinics c ON c.handle=r.clinic "
           "WHERE r.like_rate IS NOT NULL AND COALESCE(r.hook_en,'')!=''")
    params: list = []
    if clinic:
        sql += " AND r.clinic=?"; params.append(clinic)
    elif speciality:
        sql += " AND c.speciality=?"; params.append(speciality)
    rows = db.rows(sql, params)
    if organic:
        rows = [r for r in rows if _val(r, "flag") == "organic"]
    return rows


def _group(rows: list[dict]) -> dict:
    best = max(rows, key=lambda r: r["like_rate"])
    return {"n": len(rows), "like_rate": round(statistics.median(r["like_rate"] for r in rows), 2),
            "views": int(statistics.median(r["views"] or 0 for r in rows)),
            "accounts": len({r["clinic"] for r in rows}),
            "best": {"hook": best.get("hook_en"), "like_rate": best["like_rate"], "clinic": best["clinic"]}}


def _check(*fields):
    for f in fields:
        if f and f not in FIELDS:
            raise HTTPException(400, f"unknown field {f!r}")


@router.get("/api/categories")
def categories(a: str = "format", b: str | None = None, speciality: str | None = None, clinic: str | None = None, organic: bool = True):
    _check(a, b)
    rows = _rows(speciality, clinic, organic)
    ga: dict = {}; gb: dict = {}; cells: dict = {}
    for r in rows:
        va = _val(r, a)
        if va:
            ga.setdefault(va, []).append(r)
        if b:
            vb = _val(r, b)
            if vb:
                gb.setdefault(vb, []).append(r)
            if va and vb:
                cells.setdefault((va, vb), []).append(r)
    lr = [r["like_rate"] for r in rows]
    return {
        "total": len(rows), "median": round(statistics.median(lr), 2) if lr else None,
        "a": sorted(({"value": k, **_group(v)} for k, v in ga.items()), key=lambda x: -x["n"]),
        "b": sorted(({"value": k, **_group(v)} for k, v in gb.items()), key=lambda x: -x["n"]),
        "cells": sorted(({"a": k[0], "b": k[1], **_group(v)} for k, v in cells.items()), key=lambda x: -x["like_rate"]),
        "names": {"language": LANG_NAMES},
    }


@router.get("/api/categories/reels")
def category_reels(a: str, av: str, b: str | None = None, bv: str | None = None, speciality: str | None = None,
                   clinic: str | None = None, organic: bool = True, sort: str = "like_rate"):
    _check(a, b)
    rows = [r for r in _rows(speciality, clinic, organic) if _val(r, a) == av and (not b or bv is None or _val(r, b) == bv)]
    key = {"views": lambda r: -(r["views"] or 0), "date": lambda r: r.get("date") or ""}.get(sort, lambda r: -(r["like_rate"] or 0))
    rows.sort(key=key, reverse=(sort == "date"))
    return {"reels": rows}


class Rename(BaseModel):
    field: str
    old: str
    new: str
    speciality: str | None = None


@router.post("/api/categories/rename")
def rename(body: Rename):
    """Rename a label, or merge it into another by giving that label's name. Applies to every reel of the speciality
    (annotated or not) and is written back to each account's annotations.json so re-runs keep it."""
    if body.field not in ("format", "hook_type", "flag"):
        raise HTTPException(400, "Only format, hook type and flag labels can be renamed")
    new = "-".join(body.new.strip().lower().split())
    if not new or new == body.old:
        raise HTTPException(400, "Give the label a different name")
    sql = f"SELECT r.shortcode, r.clinic, r.{body.field} v FROM reels r LEFT JOIN clinics c ON c.handle=r.clinic WHERE r.{body.field} IS NOT NULL"
    params: list = []
    if body.speciality:
        sql += " AND c.speciality=?"; params.append(body.speciality)
    hits = [r for r in db.rows(sql, params) if (r["v"] or "").split(";")[0].strip() == body.old]
    by_clinic: dict = {}
    with db.tx() as c:
        for r in hits:
            rest = (r["v"] or "").split(";", 1)
            value = new + (";" + rest[1] if len(rest) > 1 else "")
            c.execute(f"UPDATE reels SET {body.field}=?, edited=1 WHERE shortcode=?", (value, r["shortcode"]))
            by_clinic.setdefault(r["clinic"], {})[r["shortcode"]] = value
    for clinic, changes in by_clinic.items():
        p = DATA_ROOT / clinic / "annotations.json"
        if not p.parent.is_dir():
            continue
        ann = json.loads(p.read_text()) if p.exists() else {}
        for code, value in changes.items():
            ann.setdefault(code, {})[body.field] = value
        p.write_text(json.dumps(ann, ensure_ascii=False, indent=1))
    return {"changed": len(hits), "new": new}
