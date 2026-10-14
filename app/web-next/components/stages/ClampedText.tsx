// Supporting text clamped to 2 lines (or `lines` = 1) with an ellipsis at every length. No toggle: the full
// text is exposed as the native title tooltip. CSS clamping does not hide text from assistive tech, so
// screen readers read the full DOM text. The clamped element is focusable so keyboard users can reach the tooltip.
export function ClampedText({ text, className = "", lines = 2, title }: { text: string; className?: string; lines?: 1 | 2; title?: string }) {
  return (
    <span className={`block ${className}`}>
      <span tabIndex={0} title={title ?? text} className={`block whitespace-pre-wrap break-words ${lines === 1 ? "line-clamp-1" : "line-clamp-2"}`}>{text}</span>
    </span>
  );
}
