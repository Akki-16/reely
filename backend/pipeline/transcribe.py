"""Transcription (and optional English translation) of downloaded reels.

Two engines behind one interface:
  faster-whisper  CTranslate2 int8 on the CPU (the default)
  whisper.cpp     GGML models on the Apple GPU through Metal, via the bundled whisper-cli binary
Both produce the same transcript JSON: {shortcode, file, language, language_probability, duration, model, engine,
segments:[{start,end,text}], text} plus text_en/segments_en from the translate task.
"""
import json
import os
import re
import subprocess
import tempfile
import time
import wave
from pathlib import Path

from config import GGML_DIR, GGML_VAD, WHISPER_CLI, engine_for_model, model_for_engine, model_info
from .views_fmt import shortcode_from_stem, transcript_path, info_path, video_path

_engines: dict = {}


class Result:
    __slots__ = ("segments", "language", "language_probability", "duration", "gpu")

    def __init__(self, segments, language, language_probability, duration, gpu=False):
        self.segments = segments; self.language = language; self.language_probability = language_probability
        self.duration = duration; self.gpu = gpu


class FasterWhisper:
    id = "faster-whisper"

    def __init__(self, size: str):
        from faster_whisper import WhisperModel
        self.size = size
        self.model = WhisperModel(size, device="cpu", compute_type="int8")

    def run(self, media: Path, translate: bool = False) -> Result:
        segs, info = self.model.transcribe(str(media), task="translate" if translate else "transcribe", beam_size=5, vad_filter=True)
        segs = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segs]
        return Result(segs, info.language, round(info.language_probability, 2), round(info.duration, 1))


class WhisperCpp:
    """whisper.cpp through the static `whisper-cli` (GGML_METAL=1, embedded shader library). Audio is decoded to
    16 kHz mono WAV with PyAV first, since the binary itself reads only wav/mp3/flac/ogg."""
    id = "whisper.cpp"
    _lang_re = re.compile(r"auto-detected language: (\w+) \(p = ([0-9.]+)\)")

    def __init__(self, size: str):
        self.size = size
        m = model_info(size)
        self.model_path = GGML_DIR / m["file"] if m else GGML_DIR / f"{size}.bin"
        if not WHISPER_CLI.exists():
            raise RuntimeError(f"whisper-cli binary missing at {WHISPER_CLI}")
        if not self.model_path.exists():
            raise RuntimeError(f"{size} is not downloaded — fetch it in Settings")
        self.vad_path = GGML_DIR / GGML_VAD["file"]
        self.threads = str(max(2, min(8, os.cpu_count() or 4)))
        self.gpu_seen = False

    @staticmethod
    def _to_wav16k(src: Path, dst: Path) -> float:
        import av
        import numpy as np
        resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)
        chunks = []
        with av.open(str(src), metadata_errors="ignore") as c:
            for frame in c.decode(c.streams.audio[0]):
                for f in resampler.resample(frame):
                    chunks.append(f.to_ndarray())
            for f in resampler.resample(None):
                chunks.append(f.to_ndarray())
        data = np.concatenate(chunks, axis=1) if chunks else np.zeros((1, 0), dtype=np.int16)
        with wave.open(str(dst), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(data.tobytes())
        return data.shape[1] / 16000

    # Decoding defaults, chosen on Hindi/English reels against faster-whisper's output:
    #  -bs 5           beam search like faster-whisper
    #  --vad -vo 0     Silero VAD without the 0.1 s chunk overlap; the overlap produced 0.1 s stub segments whose
    #                  timestamps ran backwards and made every window fall back to higher temperatures
    #  -tpi 0.5        temperature ladder 0 / 0.5 / 1.0 instead of six steps: keeps the repetition-loop safety net
    #                  but caps a window at two retries
    ARGS = ["-bs", "5", "-tpi", "0.5"]
    VAD_ARGS = ["--vad", "-vo", "0"]

    def _detect(self, wav: Path) -> tuple[str | None, float]:
        """Language of the first 30 s of the raw audio (-dl pass, ~1 s on the GPU). Detecting on the VAD-trimmed audio
        that the main pass uses was markedly worse (large-v3-turbo called Hindi reels English), and the raw-audio
        detection matches what faster-whisper reports."""
        r = subprocess.run([str(WHISPER_CLI), "-m", str(self.model_path), "-f", str(wav), "-dl", "-t", self.threads],
                           capture_output=True, timeout=600)
        log = (r.stderr or b"").decode("utf-8", "replace") + (r.stdout or b"").decode("utf-8", "replace")
        if "ggml_metal_init" in log:
            self.gpu_seen = True
        m = self._lang_re.search(log)
        return (m.group(1), round(float(m.group(2)), 2)) if m else (None, 0.0)

    def run(self, media: Path, translate: bool = False) -> Result:
        with tempfile.TemporaryDirectory(prefix="reely-wcpp-") as tmp:
            wav = Path(tmp) / "audio.wav"; out = Path(tmp) / "out"
            duration = self._to_wav16k(media, wav)
            lang, prob = self._detect(wav)
            cmd = [str(WHISPER_CLI), "-m", str(self.model_path), "-f", str(wav), "-l", lang or "auto", "-t", self.threads,
                   "-oj", "-of", str(out), *self.ARGS]
            if self.vad_path.exists():
                cmd += [*self.VAD_ARGS, "-vm", str(self.vad_path)]
            if translate:
                cmd.append("-tr")
            r = subprocess.run(cmd, capture_output=True, timeout=3600)
            log = (r.stderr or b"").decode("utf-8", "replace") + (r.stdout or b"").decode("utf-8", "replace")
            if "ggml_metal_init" in log:
                self.gpu_seen = True
            if r.returncode != 0 or not out.with_suffix(".json").exists():
                tail = "\n".join(log.strip().splitlines()[-6:])
                raise RuntimeError(f"whisper-cli failed ({r.returncode}): {tail}")
            # whisper.cpp can cut a segment inside a multibyte character, so the file is not always valid UTF-8
            res = json.loads(out.with_suffix(".json").read_bytes().decode("utf-8", "replace"))
        segs = self._segments(res.get("transcription", []))
        if not lang:
            lang = (res.get("result") or {}).get("language") or "en"
            m = self._lang_re.search(log)
            if m:
                lang, prob = m.group(1), round(float(m.group(2)), 2)
        return Result(segs, lang, prob, round(duration, 1), gpu=self.gpu_seen)

    @staticmethod
    def _segments(raw: list) -> list:
        """whisper.cpp JSON -> Reely segments. Drops the stub segments it sometimes emits (a ~0.1 s fragment that the
        next segment, starting at the same time, repeats in full) and the replacement characters from split bytes."""
        out = []
        for i, s in enumerate(raw):
            start, end = s["offsets"]["from"] / 1000, s["offsets"]["to"] / 1000
            text = s.get("text", "").replace("\ufffd", "").strip()
            nxt = raw[i + 1] if i + 1 < len(raw) else None
            if nxt and end - start < 0.25 and abs(nxt["offsets"]["from"] / 1000 - start) < 0.05:
                continue
            if text:
                out.append({"start": round(start, 2), "end": round(end, 2), "text": text})
        return out


def get_engine(size: str, engine: str | None = None):
    """Engine instance for a (size, engine) pair; the model id wins when the two disagree (ggml-* is whisper.cpp)."""
    engine = engine or engine_for_model(size)
    size = model_for_engine(engine, size)
    key = (engine, size)
    if key not in _engines:
        _engines[key] = (WhisperCpp if engine == "whisper.cpp" else FasterWhisper)(size)
    return _engines[key]


def translation_model(size: str, engine: str) -> str:
    """large-v3-turbo was distilled for transcription only and tends to answer the translate task in the source
    language, so English translation prefers an installed non-turbo model of the same engine when there is one."""
    if "turbo" not in size:
        return size
    try:
        import models_mgr
        installed = {m["id"] for m in models_mgr.list_models() if m["installed"]}
    except Exception:
        return size
    from config import TRANSLATE_FALLBACKS
    return next((c for c in TRANSLATE_FALLBACKS[engine] if c in installed), size)


def get_model(size: str):
    """Back-compat: the faster-whisper model object."""
    return get_engine(size, "faster-whisper").model


def pending(clinic_dir: Path):
    vd = clinic_dir / "videos"
    out = []
    for p in sorted(vd.glob("*.mp4")):
        code = shortcode_from_stem(p.stem)
        if not transcript_path(clinic_dir, code) and info_path(clinic_dir, code):
            out.append((p, code))
    return out


def transcribe_all(clinic_dir: Path, size: str, progress=None, should_stop=lambda: False, engine: str | None = None) -> dict:
    td = clinic_dir / "transcripts"; td.mkdir(exist_ok=True)
    todo = pending(clinic_dir)
    done = errors = 0
    langs: dict = {}
    if not todo:
        return {"done": 0, "errors": 0, "languages": langs}
    try:
        eng = get_engine(size, engine)
    except Exception as e:
        if progress: progress(0, len(todo), f"ERROR {e}", langs)
        return {"done": 0, "errors": len(todo), "languages": langs}
    for i, (p, code) in enumerate(todo, 1):
        if should_stop():
            break
        t0 = time.time()
        try:
            r = eng.run(p)
            out = {"shortcode": code, "file": p.name, "language": r.language,
                   "language_probability": r.language_probability,
                   "duration": r.duration, "model": eng.size, "engine": eng.id,
                   "segments": r.segments, "text": " ".join(s["text"] for s in r.segments)}
            (td / f"{p.stem}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
            done += 1; langs[r.language] = langs.get(r.language, 0) + 1
            from . import failures as _f; _f.clear(clinic_dir, code, "transcribe")
            tag = " · Metal" if getattr(r, "gpu", False) else ""
            if progress: progress(i, len(todo), f"{code} {r.language} {r.duration}s in {round(time.time()-t0,1)}s{tag}", langs)
        except Exception as e:
            errors += 1
            from . import failures as _f; _f.record(clinic_dir, code, "transcribe", str(e) or type(e).__name__)
            if progress: progress(i, len(todo), f"{code} ERROR {e}", langs)
    return {"done": done, "errors": errors, "languages": langs}


def translate_all(clinic_dir: Path, size: str, progress=None, should_stop=lambda: False, target: str = "en", engine: str | None = None) -> dict:
    """Translate reels not already in `target`. English comes from Whisper's translate task (on-device, from audio);
    any other target goes through the Claude CLI in batches. Results land in the transcript JSON as text_en (English)
    or text_tr + tr_lang (other languages)."""
    if target and target != "en":
        return _translate_with_claude(clinic_dir, target, progress, should_stop)
    td = clinic_dir / "transcripts"
    todo = []
    for tp in sorted(td.glob("*.json")):
        d = json.loads(tp.read_text())
        if d.get("language") not in (None, "en") and not d.get("text_en") and d.get("text"):
            todo.append((tp, d))
    done = 0
    if not todo:
        return {"done": 0}
    try:
        engine = engine or engine_for_model(size)
        tsize = translation_model(model_for_engine(engine, size), engine)
        eng = get_engine(tsize, engine)
        if tsize != model_for_engine(engine, size) and progress:
            progress(0, len(todo), f"translating with {tsize} (turbo models do not translate)")
    except Exception as e:
        if progress: progress(0, len(todo), f"ERROR {e}")
        return {"done": 0}
    for i, (tp, d) in enumerate(todo, 1):
        if should_stop():
            break
        vp = video_path(clinic_dir, d.get("shortcode") or shortcode_from_stem(tp.stem))
        if not vp or not vp.exists():
            if progress: progress(i, len(todo), f"{tp.stem}: video missing, skipped")
            continue
        try:
            r = eng.run(vp, translate=True)
            d["segments_en"] = r.segments
            d["text_en"] = " ".join(s["text"] for s in r.segments)
            tp.write_text(json.dumps(d, ensure_ascii=False, indent=1))
            done += 1
            if progress: progress(i, len(todo), f"{d['shortcode']} translated")
        except Exception as e:
            if progress: progress(i, len(todo), f"{d['shortcode']} ERROR {e}")
    return {"done": done}


def _translate_with_claude(clinic_dir: Path, target: str, progress=None, should_stop=lambda: False, batch: int = 20) -> dict:
    import claude_cli
    from config import lang_name
    name = lang_name(target)
    td = clinic_dir / "transcripts"
    todo = []
    for tp in sorted(td.glob("*.json")):
        d = json.loads(tp.read_text())
        if d.get("language") != target and d.get("text") and not (d.get("text_tr") and d.get("tr_lang") == target):
            todo.append((tp, d))
    done = 0
    for b in range(0, len(todo), batch):
        if should_stop():
            break
        chunk = todo[b:b + batch]
        items = "\n\n".join(f"[{d['shortcode']}] ({d.get('language')}) {d['text'][:2500]}" for _, d in chunk)
        prompt = (f"Translate each Instagram reel transcript below into {name}. Keep the meaning and tone, do not summarise, "
                  f"keep brand and product names as they are. Return ONLY a JSON object mapping shortcode to the {name} translation.\n\n{items}")
        try:
            res = claude_cli.run(prompt, cwd=clinic_dir, json_out=True)
            out = claude_cli.extract_json(res["text"]) or {}
        except Exception as e:
            if progress: progress(min(b + batch, len(todo)), len(todo), f"batch ERROR {str(e)[:120]}")
            continue
        for tp, d in chunk:
            tr = out.get(d["shortcode"])
            if isinstance(tr, str) and tr.strip():
                d["text_tr"] = tr.strip(); d["tr_lang"] = target
                tp.write_text(json.dumps(d, ensure_ascii=False, indent=1))
                done += 1
        if progress: progress(min(b + batch, len(todo)), len(todo), f"{done} translated to {name} via Claude")
    return {"done": done}


def translate_one(clinic_dir: Path, shortcode: str, target: str, size: str, engine: str | None = None) -> dict:
    """Translate a single reel's transcript into `target` and store it in its transcript JSON.
    English: the engine's translate task from the audio (text_en/segments_en). Others: Claude (translations[target]).
    Every result is also mirrored into translations[<lang>] so the UI can list what exists."""
    import claude_cli
    from config import lang_name
    tp = transcript_path(clinic_dir, shortcode)
    if not tp:
        raise FileNotFoundError("no transcript for this reel yet")
    d = json.loads(tp.read_text())
    d.setdefault("translations", {})
    if target == "en":
        vp = video_path(clinic_dir, shortcode)
        if not vp or not vp.exists():
            raise FileNotFoundError("video file missing")
        engine = engine or engine_for_model(size)
        tsize = translation_model(model_for_engine(engine, size), engine)
        r = get_engine(tsize, engine).run(vp, translate=True)
        d["segments_en"] = r.segments
        d["text_en"] = " ".join(s["text"] for s in r.segments)
        d["translations"]["en"] = d["text_en"]
    else:
        name = lang_name(target)
        prompt = (f"Translate this Instagram reel transcript into {name}. Keep the meaning and tone, do not summarise, "
                  f"keep brand and product names as they are. Return ONLY a JSON object {{\"text\": \"<the {name} translation>\"}}.\n\n"
                  f"({d.get('language')}) {d.get('text', '')[:4000]}")
        res = claude_cli.run(prompt, cwd=clinic_dir, json_out=True)
        out = claude_cli.extract_json(res["text"]) or {}
        text = (out.get("text") if isinstance(out, dict) else None) or ""
        if not text.strip():
            raise RuntimeError("Claude returned no translation")
        d["translations"][target] = text.strip()
        d["text_tr"] = text.strip(); d["tr_lang"] = target
    tp.write_text(json.dumps(d, ensure_ascii=False, indent=1))
    return d
