// Supporting text clamped to 2 lines with an ellipsis at every length. No toggle: the full
// text is exposed as the native title tooltip. CSS clamping does not hide text from assistive tech, so
// screen readers read the full DOM text. The clamped element is focusable so keyboard users can reach the tooltip.
export function ClampedText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`block ${className}`}>
      <span tabIndex={0} title={text} className="block whitespace-pre-wrap break-words line-clamp-2">{text}</span>
    </span>
  );
}
