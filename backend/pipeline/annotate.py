"""Annotation via Claude CLI (default), or a hand-off file for an interactive session."""
import json
from pathlib import Path

import claude_cli

VOCAB = """hook_type: question-to-camera, scenario-opener, family-dialogue, myth-bust, statistic, bold-claim, confession,
rapid-fire, emotional-story, vlog-opener, celebrity-clip, tv-host-opener, scenario-analogy, listicle-pattern, shock-claim,
seasonal-fear, pun, interview-question, self-intro, silent
format: pageant-skit, family-skit, comedy-skit, doctor-explainer, doctor-explainer-long, influencer-vlog, patient-story,
seasonal-promo-voiceover, kbc-amitabh-psa, celeb-film-tie-in, brand-milestone, product-explainer, pageant-testimonial,
pageant-testimonial-monologue, pageant-montage, silent-text-reel, jingle-promo, ugc-style-skit
flag: organic, paid-celebrity, pageant-sponsorship, influencer-collab, celebrity-tv-tie-in, not-downloaded; append
"; duplicate repost of <shortcode>" when a transcript matches another reel's."""


def build_batch(rows: list[dict], max_chars: int = 1400) -> str:
    lines = []
    for r in rows:
        tr = (r.get("transcript_en") or r.get("transcript_original") or "")[:max_chars]
        lines.append(
            f"### {r['shortcode']} | {r['views']} views | like-rate {r.get('like_rate_pct')}% | {r.get('date')} | "
            f"{r.get('duration_s')}s | lang {r.get('language')}\n"
            f"CAPTION: {(r.get('caption') or '')[:300]}\nHOOK(0-5s): {r.get('hook_spoken_original','')}\nTRANSCRIPT: {tr}\n")
    return "\n".join(lines)


def clinic_kind(clinic_dir: Path) -> str:
    """Speciality word for prompts, from clinic.json (written by the app) with a dental fallback."""
    try:
        import json
        sp = json.loads((clinic_dir / "clinic.json").read_text()).get("speciality")
        return sp.lower() if sp else "healthcare"
    except Exception:
        return "healthcare"


def build_prompt(clinic: str, rows: list[dict], kind: str = "dental") -> str:
    return f"""You are annotating Instagram reels for a {kind}-clinic content research project.
Account: @{clinic}. Below are {len(rows)} reels with caption, the spoken hook (first 5 seconds) and transcript.

For EVERY reel return one JSON object keyed by shortcode with these fields:
- hook_en: the opening line in natural English (translate if needed; 1-2 sentences)
- hook_type: one label from the vocabulary (invent a new kebab-case label only if none fits)
- format: one label from the vocabulary
- cta: the call to action in a few words, or "implicit" / "none"
- flag: from the vocabulary; use like-rate and caption cues (sponsorship, celebrity names, #ad) to judge paid vs organic
- summary: 1-2 lines on what the reel says and why it might have worked; if the transcript is garbled say so and use the caption

Vocabulary:
{VOCAB}

Reply with ONLY a JSON object: {{"<shortcode>": {{...}}, ...}}. No prose before or after.

{build_batch(rows)}"""


def annotate_cli(clinic_dir: Path, rows: list[dict], progress=None, batch_size: int = 50) -> dict:
    ann_path = clinic_dir / "annotations.json"
    ann = json.loads(ann_path.read_text()) if ann_path.exists() else {}
    todo = [r for r in rows if r["shortcode"] not in ann and (r.get("transcript_original") or r.get("caption"))]
    for i in range(0, len(todo), batch_size):
        batch = todo[i:i + batch_size]
        if progress: progress(i, len(todo), f"Asking Claude about {len(batch)} reels…")
        res = claude_cli.run(build_prompt(clinic_dir.name, batch, clinic_kind(clinic_dir)), cwd=clinic_dir)
        data = claude_cli.extract_json(res["text"])
        for code, a in data.items():
            if isinstance(a, dict):
                ann[code] = {k: a.get(k, "") for k in ("hook_en", "hook_type", "format", "cta", "flag", "summary")}
        ann_path.write_text(json.dumps(ann, ensure_ascii=False, indent=1))
        if progress: progress(min(i + batch_size, len(todo)), len(todo), f"{len(ann)} annotated")
    return {"annotated": len(ann), "requested": len(todo)}


def write_handoff(clinic_dir: Path, rows: list[dict]) -> Path:
    """For the no-CLI path: write a request file the user pastes into a Claude Code session."""
    p = clinic_dir / "ANNOTATION_REQUEST.md"
    p.write_text(
        f"# Annotate @{clinic_dir.name}\n\nIn a Claude Code session opened in this folder, say:\n\n"
        f"> Read ANNOTATION_REQUEST.md and write annotations.json for every reel below using the vocabulary.\n\n"
        f"{VOCAB}\n\nOutput: `annotations.json` = {{\"<shortcode>\": {{hook_en, hook_type, format, cta, flag, summary}}}}\n\n---\n\n"
        + build_batch(rows))
    return p
