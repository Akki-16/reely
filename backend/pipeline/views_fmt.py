"""Shared helpers: view-count labels for file names, and shortcode lookup.

File naming: every per-reel file shares one stem  <views>_<shortcode>
    videos/1.50mil_DNzn0cDYjdp.mp4
    videos/1.50mil_DNzn0cDYjdp.info.json
    transcripts/1.50mil_DNzn0cDYjdp.json
The shortcode suffix keeps names unique (many reels share a rounded count) and joins to the CSVs,
which carry the same stem in a file_name column.
"""
import csv
import re
from pathlib import Path


def views_label(v):
    if v is None or v == '':
        return 'na'
    v = int(v)
    if v < 1000:
        return str(v)
    if v < 1_000_000:
        return f'{v/1000:.2f}k'
    return f'{v/1_000_000:.2f}mil'


def views_by_shortcode(clinic_dir):
    return {r['shortcode']: r['views'] for r in csv.DictReader(open(Path(clinic_dir) / 'reels_index.csv'))}


def shortcode_from_stem(stem):
    """'1.50mil_DNzn0cDYjdp' -> 'DNzn0cDYjdp'; plain 'DNzn0cDYjdp' passes through.
    Shortcodes themselves may contain underscores (e.g. C5V88zQS_Gg), so split on the label only."""
    m = re.match(r'^(\d+(?:\.\d+)?(?:k|mil)|na)_(.+)$', stem)
    return m.group(2) if m else stem


def _find(folder, shortcode, ext):
    hits = list(folder.glob(f'*_{shortcode}{ext}')) or list(folder.glob(f'{shortcode}{ext}'))
    return hits[0] if hits else None


def video_path(clinic_dir, shortcode):
    return _find(Path(clinic_dir) / 'videos', shortcode, '.mp4')


def transcript_path(clinic_dir, shortcode):
    return _find(Path(clinic_dir) / 'transcripts', shortcode, '.json')


def info_path(clinic_dir, shortcode):
    return _find(Path(clinic_dir) / 'videos', shortcode, '.info.json')


def file_stem(views, shortcode):
    """The shared base name used by video, transcript and metadata: '1.50mil_DNzn0cDYjdp'."""
    return f'{views_label(views)}_{shortcode}'
