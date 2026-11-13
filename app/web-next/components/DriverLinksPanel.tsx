"use client";

// DriverLinksPanel — S1 검증 성장 드라이버 패널 (spec
// 2026-11-13-s2-driver-linkage D-B/D-D). 기회 상세 화면의 요인 탭에 놓이는
// 증거 블록: 분석가가 S1 보정에서 수용한 드라이버를 이 기회에 연결(attach)·
// 해제(remove)한다. 순수 뷰 — 데이터와 액션은 소유자(상세 화면)가 props로
// 넘기고 이 컴포넌트는 fetch를 하지 않는다(market-growth-banner-render의
// 순수 뷰 규약). 모든 연결 기록은 서버가 찍은 신뢰도 C 라벨을 그대로 렌더한다
// — 사람의 수용이 LLM 추정을 검증 사실로 올리지 않는다(경계 D-E.3).
// 방향은 글리프와 텍스트로 함께 전달하고(색만으로 전달 금지), 근거는
// details/summary로 키보드 조작 가능하게 펼친다.
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { DriverLinkRecord } from "../lib/opportunity-driver-links.ts";

/** insights payload의 calibration.accepted_drivers 행 — 연결 선택 목록의 소스. */
export interface AcceptedDriverOption {
  id: string;
  driver: string;
  direction: "upside" | "downside";
  impact_pct: number;
  rationale: string;
  decided_by: string | null;
  decided_at: string | null;
  version_no: number | null;
}

const DIRECTION_GLYPH = { upside: "▲", downside: "▼" } as const;

function impactText(d: { direction: "upside" | "downside"; impact_pct: number }): string {
  const sign = d.direction === "upside" ? "+" : "-";
  return `${sign}${d.impact_pct}%p`;
}

export function DriverLinksPanel({
  opportunityName,
  industryId,
  acceptedDrivers,
  links,
  canAct,
  busy,
  onAttach,
  onRemove,
}: {
  opportunityName: string;
  industryId: string | null;
  acceptedDrivers: AcceptedDriverOption[];
  links: DriverLinkRecord[];
  canAct: boolean;
  busy?: boolean;
  onAttach?: (driverRowId: string) => void;
  onRemove?: (driverRowId: string) => void;
}) {
  const t = useTranslations("components.driverLinks");
  const [selected, setSelected] = useState("");

  // 아직 연결되지 않은 수용 드라이버만 선택 목록에 남긴다.
  const attachable = acceptedDrivers.filter((d) => !links.some((l) => l.driver_row_id === d.id));
  const noIndustry = !industryId;
  const noDrivers = attachable.length === 0;
  const disabledReason = noIndustry ? t("noIndustryReason") : noDrivers ? t("noDriversReason") : null;

  return (
    <div className="sizing-grade-card mt-4" data-testid="driver-links-panel">
      <h4 className="text-[length:var(--fs-body)] mb-1">{t("heading")}</h4>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("boundaryNote")}</p>
      {links.length > 0 ? (
        <ul className="sizing-note-list">
          {links.map((l) => (
            <li key={l.driver_row_id}>
              <span className="mono-num">
                {DIRECTION_GLYPH[l.direction]}{" "}
                {l.direction === "upside" ? t("directionUpside") : t("directionDownside")} {impactText(l)}
              </span>{" "}
              {l.driver}
              <span className="status-chip ml-1">{t("provenanceLabel")}</span>
              {l.decided_at && (
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {" "}
                  · {l.decided_at.slice(0, 10)}
                </span>
              )}
              {l.note && (
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {" "}
                  · {t("noteLabel")}: {l.note}
                </span>
              )}
              <details className="mt-1">
                <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {t("rationaleLabel")}
                </summary>
                <p className="text-[length:var(--fs-caption)] whitespace-pre-line mb-0">{l.rationale}</p>
              </details>
              {canAct && onRemove && (
                <button
                  type="button"
                  className="btn-danger btn-sm ml-1"
                  disabled={busy}
                  aria-label={t("removeAria", { p1: l.driver })}
                  onClick={() => onRemove(l.driver_row_id)}
                >
                  {t("removeButton")}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">{t("empty")}</p>
      )}
      {canAct && onAttach && (
        <div className="flex flex-wrap items-center gap-1 mt-2">
          <select
            aria-label={t("attachSelectAria", { p1: opportunityName })}
            value={selected}
            disabled={disabledReason !== null || busy}
            onChange={(e) => setSelected(e.target.value)}
            className="sizing-new-input sizing-new-input-sm"
          >
            <option value="">{t("attachSelectPlaceholder")}</option>
            {attachable.map((d) => (
              <option key={d.id} value={d.id}>
                {DIRECTION_GLYPH[d.direction]}{" "}
                {d.direction === "upside" ? t("directionUpside") : t("directionDownside")} {impactText(d)} — {d.driver}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={disabledReason !== null || busy || selected === ""}
            onClick={() => {
              onAttach(selected);
              setSelected("");
            }}
          >
            {t("attachButton")}
          </button>
        </div>
      )}
      {canAct && disabledReason && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0" role="note">
          {disabledReason}
        </p>
      )}
    </div>
  );
}
