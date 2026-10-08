"use client";

// Deal-scoped breadcrumb (R2-A): 검토/안건 보드 › <안건명> › S3 시너지… [› 탭].
// The deal name is resolved from the opportunity; until it arrives (or when it
// cannot be read) the generic label "검토/안건" keeps the trail complete.
import { Breadcrumb, type Crumb } from "./Breadcrumb.tsx";
import { STAGE_META, type StageMetaId } from "../lib/stage-meta.ts";
import { useDealContext } from "../lib/use-deal-context.ts";

export function DealBreadcrumb({ dealId, stageId, tail = [] }: { dealId: string; stageId?: StageMetaId; tail?: Crumb[] }) {
  const { ctx } = useDealContext(dealId);
  const stage = stageId ? STAGE_META.find((s) => s.id === stageId) : undefined;
  const items: Crumb[] = [
    { label: "검토/안건 보드", href: "/deals" },
    { label: ctx?.name ?? "검토/안건", href: stage || tail.length > 0 ? `/deals/${encodeURIComponent(dealId)}` : undefined },
  ];
  if (stage) {
    items.push({
      label: `${stage.id} ${stage.name}`,
      href: tail.length > 0 ? `/deals/${encodeURIComponent(dealId)}/${stage.id.toLowerCase()}` : undefined,
    });
  }
  items.push(...tail);
  return <Breadcrumb items={items} />;
}
