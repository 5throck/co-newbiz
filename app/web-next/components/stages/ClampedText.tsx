"use client";
// Supporting text clamped to 2 lines with a 더보기/접기 toggle. The toggle renders only
// when the text is longer than CLAMP_THRESHOLD characters, so short notes stay plain.
import { useId, useState } from "react";

export const CLAMP_THRESHOLD = 80;

export function ClampedText({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const long = text.length > CLAMP_THRESHOLD;
  return (
    <span className={`block ${className}`}>
      <span id={id} className={`block whitespace-pre-wrap break-words ${long && !open ? "line-clamp-2" : ""}`}>{text}</span>
      {long && (
        <button type="button" className="btn-ghost btn-sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
          {open ? "접기" : "더보기"}
        </button>
      )}
    </span>
  );
}
