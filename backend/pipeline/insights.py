"""INSIGHTS.md via Claude CLI from the merged sheet + stats."""
import json
from pathlib import Path

import claude_cli


def build_prompt(clinic: str, rows: list[dict], stats: dict, kind: str = "dental") -> str:
    compact = [{k: r.get(k) for k in ("shortcode", "views", "like_rate_pct", "date", "duration_s", "language",
                                      "hook_en", "hook_type", "format", "flag", "script_summary")} for r in rows]
    return f"""Write INSIGHTS.md for the Instagram account @{clinic} ({kind} clinic), based on its top {len(rows)} reels by views.

Use these sections, in Markdown, concise and concrete:
1. The headline: what the median like-rate says (organic reels run 1-5%; promoted ones sit far lower). Table of like-rate by flag.
2. The reels that actually resonated (like-rate leaderboard, top 6-8, one line each on why).
3. Formats in the top {len(rows)}: table with count, typical length, one-line note.
4. Hook patterns worth stealing: numbered, each with an example line and count.
5. Operational takeaways (localisation, length, reposts, caption-as-title, CTA style).
6. Data caveats.

Stats (JSON): {json.dumps(stats)[:6000]}

Reels (JSON, one per line):
{chr(10).join(json.dumps(r, ensure_ascii=False) for r in compact)}

Reply with the Markdown document only."""


def write_insights(clinic_dir: Path, rows: list[dict], stats: dict) -> Path:
    from .annotate import clinic_kind
    res = claude_cli.run(build_prompt(clinic_dir.name, rows, stats, clinic_kind(clinic_dir)), cwd=clinic_dir, json_out=True)
    text = res["text"].strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("markdown"):
            text = text[len("markdown"):]
        text = text.strip()
    p = clinic_dir / "INSIGHTS.md"
    p.write_text(text + "\n")
    return p
