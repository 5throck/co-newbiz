#!/usr/bin/env python3
"""
Shared theme (Korean font resolution, sizes, colors) for the co-newbiz
document renderer (design v1.0 section 4-8).

The known hard part of the renderer per the design note is Korean font
handling — reportlab does not ship a CJK font, so a real .ttf must be
registered via pdfmetrics. Resolution order (first hit wins):

  1. NEWBIZ_KR_FONT_DIR env var — explicit override directory
  2. python/report/fonts/ — repo-local drop-in for OFL fonts
     (Pretendard / Nanum; nothing is committed there by default)
  3. Windows system fonts — Malgun Gothic (ships with every Korean-capable
     Windows install; this system runs the on-prem server target)
  4. Linux nanum paths — /usr/share/fonts/truetype/nanum/

If none resolve, a RuntimeError names every path tried — a clear failure
beats a PDF full of tofu glyphs.

Registration names for reportlab are fixed (NewbizKR / NewbizKR-Bold)
independent of the resolved family, so style code never branches on which
font was found.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# Deterministic reportlab font registration names.
KR_FONT_REGULAR = "NewbizKR"
KR_FONT_BOLD = "NewbizKR-Bold"

# Neutral navy accent for headings / table headers — color is never the only
# signal (accessibility rule from design section 4-10 applies to exports too).
ACCENT_HEX = "1F3864"
ACCENT_RGB = (0x1F / 255, 0x38 / 255, 0x64 / 255)
HEADER_FILL_HEX = "1F3864"
ROW_ALT_FILL_HEX = "F2F2F2"
GRID_HEX = "9CA3AF"

BODY_SIZE = 10.5
BODY_LEADING = 16
CELL_SIZE = 9.0
# Heading sizes for levels 1-6; deeper levels clamp to the last value.
HEADING_SIZES = [18.0, 15.0, 13.0, 11.5, 11.0, 11.0]


@dataclass(frozen=True)
class FontSpec:
    family: str        # docx font family name (e.g. "Malgun Gothic")
    regular_path: str
    bold_path: str
    source: str        # provenance, surfaced in the render summary


def _first_existing(paths: list[str]) -> str | None:
    for p in paths:
        if p and Path(p).is_file():
            return p
    return None


def _candidate_dirs() -> list[tuple[str, str]]:
    """(directory, source_label) search order."""
    dirs = []
    env_dir = os.environ.get("NEWBIZ_KR_FONT_DIR")
    if env_dir:
        dirs.append((env_dir, "env:NEWBIZ_KR_FONT_DIR"))
    repo_local = Path(__file__).parent / "fonts"
    dirs.append((str(repo_local), "repo:python/report/fonts"))
    return dirs


def resolve_korean_font() -> FontSpec:
    """Find a Korean-capable TrueType font pair on this machine."""
    tried: list[str] = []

    # 1-2. Drop-in directories: Pretendard first (OFL, design preference),
    #      then Nanum (OFL), then any malgun*.ttf copied in.
    for directory, source in _candidate_dirs():
        for family, regular_name, bold_name in [
            ("Pretendard", "Pretendard-Regular.ttf", "Pretendard-Bold.ttf"),
            ("NanumGothic", "NanumGothic.ttf", "NanumGothicBold.ttf"),
            ("Malgun Gothic", "malgun.ttf", "malgunbd.ttf"),
        ]:
            reg = _first_existing([str(Path(directory) / regular_name)])
            bold = _first_existing([str(Path(directory) / bold_name)])
            tried.extend([str(Path(directory) / regular_name), str(Path(directory) / bold_name)])
            if reg and bold:
                return FontSpec(family, reg, bold, source)

    # 3. Windows system fonts (Malgun Gothic).
    win_dir = os.environ.get("WINDIR", r"C:\Windows") + r"\Fonts"
    reg = _first_existing([str(Path(win_dir) / "malgun.ttf")])
    bold = _first_existing([str(Path(win_dir) / "malgunbd.ttf")])
    tried.extend([str(Path(win_dir) / "malgun.ttf"), str(Path(win_dir) / "malgunbd.ttf")])
    if reg and bold:
        return FontSpec("Malgun Gothic", reg, bold, "windows-system")

    # 4. Linux nanum.
    linux_dir = "/usr/share/fonts/truetype/nanum"
    reg = _first_existing([str(Path(linux_dir) / "NanumGothic.ttf")])
    bold = _first_existing([str(Path(linux_dir) / "NanumGothicBold.ttf")])
    tried.extend([str(Path(linux_dir) / "NanumGothic.ttf"), str(Path(linux_dir) / "NanumGothicBold.ttf")])
    if reg and bold:
        return FontSpec("NanumGothic", reg, bold, "linux-system")

    raise RuntimeError(
        "No Korean TrueType font found. Tried:\n  " + "\n  ".join(tried)
        + "\nSet NEWBIZ_KR_FONT_DIR to a directory containing a Korean .ttf pair "
        "(e.g. Pretendard-Regular.ttf + Pretendard-Bold.ttf), or drop an OFL font "
        "pair into python/report/fonts/."
    )
