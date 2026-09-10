"use client";

// SketchCanvas — 비즈니스 모델 스케치 v2 렌더러 (목업 bms-v2.html 확정안).
// 캔버스(BMC 9블록)에 항목별 ERRC 배지·근거를 통합 표시하고, 하단에 ERRC 요약
// 스트립·시나리오·핵심 리스크를 둔다. 구형(v1, schema 태그 없는 6필드) 스케치는
// 텍스트 뷰로만 렌더링된다(호환 폴백).

import {
  SKETCH_BLOCK_LABELS,
  SKETCH_BLOCKS,
  sketchSchema,
  type ErrcAction,
  type SketchBlockKey,
  type SketchItem,
} from "../lib/sketch-schema.ts";

const ERRC_LABEL: Record<ErrcAction, string> = {
  eliminate: "제거",
  reduce: "감축",
  raise: "증대",
  create: "창조",
};

function Badge({ action }: { action: ErrcAction }) {
  return <span className={`bms-mk bms-mk-${action}`}>{ERRC_LABEL[action]}</span>;
}

function Item({ item }: { item: SketchItem }) {
  if (!item.action) return <li>{item.text}</li>;
  return (
    <li className="bms-item-marked">
      <span className={`bms-mk bms-mk-${item.action}`}>{ERRC_LABEL[item.action]}</span>
      {item.text}
      {item.why && <div className="bms-why">{item.why}</div>}
    </li>
  );
}

function Block({ blockKey, items }: { blockKey: SketchBlockKey; items: SketchItem[] }) {
  return (
    <div className={`bms-blk bms-blk-${blockKey}`}>
      <h3>{SKETCH_BLOCK_LABELS[blockKey]}</h3>
      <ul>
        {items.length === 0 ? <li className="bms-empty">—</li> : items.map((it, i) => <Item key={i} item={it} />)}
      </ul>
    </div>
  );
}

interface SketchV2Loose {
  canvas?: Partial<Record<SketchBlockKey, SketchItem[]>>;
  errc?: Partial<Record<ErrcAction, Array<{ item: string; why?: string }>>>;
  marketEntry?: string[];
  scenarios?: Array<{ name: string; assumption: string }>;
  keyRisks?: string[];
}

export function SketchCanvas({ sketch }: { sketch: Record<string, unknown> }) {
  const isV2 = sketchSchema(sketch) === 2;

  // ERRC 배지 집계 — 캔버스 항목 + 별도 errc 블록 항목을 합산한다.
  const counts: Record<ErrcAction, number> = { eliminate: 0, reduce: 0, raise: 0, create: 0 };
  const v2 = isV2 ? (sketch as unknown as SketchV2Loose) : null;
  if (v2) {
    for (const key of SKETCH_BLOCKS) {
      for (const it of v2.canvas?.[key] ?? []) {
        if (it.action) counts[it.action] += 1;
      }
    }
    for (const action of Object.keys(v2.errc ?? {}) as ErrcAction[]) {
      counts[action] += (v2.errc?.[action] ?? []).length;
    }
  }

  const textItems: Array<[string, string | undefined]> = [
    ["고객", (sketch as { customer?: string }).customer],
    ["가치 제안", (sketch as { valueProposition?: string }).valueProposition],
    ["수익 모델", (sketch as { revenueModel?: string }).revenueModel],
    ["필요 역량", (sketch as { requiredCapabilities?: string[] }).requiredCapabilities?.join(", ")],
    ["핵심 리스크", (sketch as { keyRisks?: string[] }).keyRisks?.join(", ")],
    [
      "시나리오 전제",
      (sketch as { scenarios?: Array<{ name: string; assumption: string }> }).scenarios
        ?.map((sc) => `${sc.name}: ${sc.assumption}`)
        .join(" / "),
    ],
  ];

  return (
    <div className="bms-root">
      {isV2 && v2 && (
        <div>
          <div className="bms-canvas">
            {SKETCH_BLOCKS.map((key) => (
              <Block key={key} blockKey={key} items={v2.canvas?.[key] ?? []} />
            ))}
          </div>

          {(v2.marketEntry?.length ?? 0) > 0 && (
            <div className="bms-entry">
              <span className="bms-entry-lbl">시장 진입</span>
              {v2.marketEntry!.map((s, i) => (
                <span key={i} className="bms-entry-step">
                  {s}
                </span>
              ))}
            </div>
          )}

          <div className="bms-legend">
            {(Object.keys(ERRC_LABEL) as ErrcAction[]).map((a) => (
              <div key={a} className={`bms-lg bms-lg-${a}`}>
                <b>
                  {ERRC_LABEL[a]} {counts[a]}
                </b>
                <span>
                  {a === "eliminate" && "업계가 당연하게 여기는 요소를 버린다"}
                  {a === "reduce" && "업계 표준보다 줄인다"}
                  {a === "raise" && "업계 기준보다 높인다"}
                  {a === "create" && "업계에 없는 것을 만든다"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isV2 && (
        <ul className="bms-text">
          {textItems.map(([label, value]) => (
            <li key={label}>
              <strong>{label}</strong> — {value ?? "—"}
            </li>
          ))}
        </ul>
      )}

      {(v2?.scenarios?.length ?? 0) > 0 && (
        <>
          <h2 className="bms-sec">시나리오 전제 (낙관 / 기본 / 비관)</h2>
          <div className="bms-aux">
            {v2!.scenarios!.map((sc, i) => (
              <div key={i} className="bms-card">
                <div className="bms-card-name">{sc.name}</div>
                <p>{sc.assumption}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {(v2?.keyRisks?.length ?? 0) > 0 && (
        <div className="bms-risks">
          <h4>핵심 리스크</h4>
          <ul>
            {v2!.keyRisks!.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
