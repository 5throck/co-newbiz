#!/usr/bin/env python3
"""
HWP 5.0 text extraction (Wave C2).

Reads legacy binary .hwp documents as OLE compound files, expands compressed
BodyText/Section streams when the FileHeader flag says so, and extracts
HWPTAG_PARA_TEXT records as UTF-16LE plain text. The parser intentionally
returns text only; layout reconstruction stays with the .hwpx renderer.

Usage:
    python python/extract_hwp.py <file.hwp>
    python python/extract_hwp.py --section-fixture tests/fixtures/hwp-section-uncompressed.bin
"""

from __future__ import annotations

import argparse
import struct
import sys
import zlib
from pathlib import Path

HWPTAG_PARA_TEXT = 67


def iter_records(data: bytes):
    i = 0
    size = len(data)
    while i + 4 <= size:
        header_int = struct.unpack_from("<I", data, i)[0]
        rec_type = header_int & 0x3FF
        rec_len = (header_int >> 20) & 0xFFF
        i += 4
        if rec_len == 0xFFF:
            if i + 4 > size:
                break
            rec_len = struct.unpack_from("<I", data, i)[0]
            i += 4
        if rec_len < 0 or i + rec_len > size:
            break
        yield rec_type, data[i : i + rec_len]
        i += rec_len


def text_from_section(section: bytes) -> str:
    chunks: list[str] = []
    for rec_type, rec_data in iter_records(section):
        if rec_type != HWPTAG_PARA_TEXT:
            continue
        text = rec_data.decode("utf-16le", errors="ignore")
        text = "".join(ch for ch in text if ord(ch) >= 32 or ch in "\n\t")
        if text:
            chunks.append(text)
    return "\n".join(chunks)


def get_text(path: str | Path) -> str:
    try:
        import olefile  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise RuntimeError("olefile is required for .hwp extraction. Install python/requirements.txt.") from exc

    ole = olefile.OleFileIO(str(path))
    try:
        dirs = ole.listdir()
        header = ole.openstream("FileHeader").read()
        is_compressed = (header[36] & 1) == 1 if len(header) > 36 else False
        section_streams = ["/".join(d) for d in dirs if len(d) >= 2 and d[0] == "BodyText" and d[-1].startswith("Section")]
        section_streams.sort(key=lambda name: int(name.rsplit("Section", 1)[-1]))
        out: list[str] = []
        for section in section_streams:
            data = ole.openstream(section).read()
            unpacked = zlib.decompress(data, -15) if is_compressed else data
            text = text_from_section(unpacked)
            if text:
                out.append(text)
        return "\n".join(out)
    finally:
        ole.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Extract plain text from HWP 5.0 BodyText streams")
    parser.add_argument("path", nargs="?", help=".hwp file path")
    parser.add_argument("--section-fixture", help="Parse an unpacked BodyText section fixture (test seam; no olefile needed)")
    args = parser.parse_args(argv)
    try:
        if args.section_fixture:
            sys.stdout.write(text_from_section(Path(args.section_fixture).read_bytes()) + "\n")
            return 0
        if not args.path:
            parser.error("path is required unless --section-fixture is used")
        sys.stdout.write(get_text(args.path) + "\n")
        return 0
    except Exception as exc:
        print(f"extract_hwp failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
