// Small inline icons (decorative, aria-hidden) for the /our-company screens; stroke = currentColor.
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;

export function CheckIcon() {
  return <svg {...base}><path d="M3 8.5l3.2 3L13 4.5" /></svg>;
}
export function ClockIcon() {
  return <svg {...base}><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.2 1.5" /></svg>;
}
