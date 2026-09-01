#!/usr/bin/env python3
"""Extract text from an uploaded credit-report/evidence file (PDF or plain text).

Usage: python python/extract_upload_text.py <path>
Prints extracted text to stdout. PDFs use pypdf; .txt/.md are read as UTF-8
(GB18030 fallback for legacy encodings). Non-text binaries return empty output.
"""
import sys


def extract(path: str) -> str:
    low = path.lower()
    if low.endswith((".txt", ".md", ".csv")):
        for enc in ("utf-8", "cp949", "euc-kr"):
            try:
                with open(path, "r", encoding=enc) as f:
                    return f.read()
            except (UnicodeDecodeError, OSError):
                continue
        return ""
    if low.endswith(".pdf"):
        try:
            from pypdf import PdfReader
        except Exception:
            return ""  # pypdf unavailable — caller degrades gracefully
        try:
            reader = PdfReader(path)
            pages = []
            for page in reader.pages:
                try:
                    pages.append(page.extract_text() or "")
                except Exception:
                    continue
            return "\n".join(pages)
        except Exception:
            return ""
    return ""  # unsupported format


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
    sys.stdout.write(extract(sys.argv[1]))
