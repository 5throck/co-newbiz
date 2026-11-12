"use client";

// 외부 참조 폐기 버튼 (design 2026-09-18-s1-growth-gap-calibration,
// amendment 2026-11-12c) — record-preserving supersede의 명시적 확인 뷰.
// CalibrationPanel의 400-line 분해 상한을 지키기 위해 버튼·확인 다이얼로그를
// 독립 뷰로 둔다(CalibrationEscalation.tsx와 같은 분해 패턴). DELETE는 물리
// 삭제가 아니라 은퇴다: 완료된 분석은 그대로 유지되고 다음 재분석 기준선부터
// 변경된다 — 확인 문구가 그 결과를 명시한다.
import { useConfirm } from "../../crud.tsx";
import { useTranslations } from "next-intl";

export function SupersedeReferenceButton({
  id,
  busy,
  onSupersede,
}: {
  /** 폐기 대상 참조 id — 확인 본문({p1})에 그대로 실린다. */
  id: string;
  busy: boolean;
  onSupersede: () => void;
}) {
  const t = useTranslations("stages.s1.calibrationPanel");
  const { confirm, confirmDialog } = useConfirm();
  return (
    <>
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={busy}
        onClick={() =>
          // 파괴적 액션 — 명시적 확인(디자인 표준: useConfirm + ConfirmDialog).
          confirm(t("supersedeConfirm"), onSupersede, {
            body: t("supersedeConfirmBody", { p1: id }),
            confirmLabel: t("supersede"),
            tone: "danger",
          })
        }
      >
        {t("supersede")}
      </button>
      {confirmDialog}
    </>
  );
}
