// Shared breadcrumb (R2-A page contract): 보드 › 안건 › 단계 › 탭. The last item
// is the current page (aria-current="page", not a link); every earlier item is a
// real link. One component for all deal / stage / opportunity pages so the
// trail and its labels stay identical.
import Link from "next/link";

export interface Crumb {
  label: string;
  /** Omit on the last (current) item. */
  href?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="현재 위치" className="breadcrumb">
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${c.label}`}>
              {last || !c.href ? (
                <span aria-current={last ? "page" : undefined}>{c.label}</span>
              ) : (
                <Link href={c.href}>{c.label}</Link>
              )}
              {!last && <span className="breadcrumb-sep" aria-hidden="true">›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
