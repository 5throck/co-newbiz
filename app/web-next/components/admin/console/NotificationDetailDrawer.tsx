"use client";

// Notification detail drawer (design 2026-10-29-scheduled-jobs-design §13.5, P4).
// GET /api/admin/notifications/[id] rendered as the established modal-panel + useModalFocus
// dialog (no drawer element exists in the codebase — the §4.2 precedent): meta block with the
// project deep link, the payload as a read-only collapsible JSON viewer, and the complete
// notification_delivery attempts table. Masked values (recipient_address_masked, target_key,
// scrubbed last_error) are rendered as-is — the client never unmasks (§13.8).
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api.ts";
import { ColGroup } from "../../ui.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { useAdminLabel } from "./admin-ui.tsx";
import { SeverityChip } from "./NotificationSection.tsx";
import type { AdminNotificationDetail, NotificationDeliveryRow } from "./types.ts";

// 전송 시도 6열 — 마스킹된 수신자와 오류가 긴 텍스트라 고정 비율 유지.
const DELIVERY_COL_PCT = [12, 26, 8, 14, 16, 24] as const;

export function NotificationDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const locale = useLocale();
  const label = useAdminLabel();
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [detail, setDetail] = useState<AdminNotificationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<AdminNotificationDetail>(`/api/admin/notifications/${encodeURIComponent(id)}`)
      .then((res) => { if (!cancelled) setDetail(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : t("loadDetailFailed")); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // The payload arrives parsed (or as the raw string when it was never valid JSON — the
  // viewer shows either honestly, read-only).
  const payloadText = detail === null ? "" : typeof detail.payload === "string" ? detail.payload : JSON.stringify(detail.payload, null, 2);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("drawerAria")} onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel" style={{ maxWidth: "56rem", width: "100%" }}>
        <div className="modal-head"><h2>{t("drawerAria")}</h2></div>
        {error !== null && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
        {detail === null && error === null && <p>{tc("loading")}</p>}
        {detail !== null && (
          <>
            <h3 className="mt-2 mb-1 text-[length:var(--fs-body)] font-semibold">{t("metaHeading")}</h3>
            <table className="data-table" aria-label={t("metaHeading")}>
              <caption className="sr-only">{t("metaHeading")}</caption>
              <tbody>
                <tr><th scope="row">{t("colTitle")}</th><td>{detail.title ?? t("titleNone")}</td></tr>
                <tr><th scope="row">{t("colSeverity")}</th><td><SeverityChip severity={detail.severity} /></td></tr>
                <tr><th scope="row">{t("colTrigger")}</th><td>{label("trigger", detail.trigger_type)}</td></tr>
                <tr><th scope="row">{t("metaUser")}</th><td>{detail.user_id}</td></tr>
                <tr><th scope="row">{t("metaProject")}</th><td>
                  {detail.project ? <Link className="text-[color:var(--accent)] underline" href={`/projects/${detail.project.id}`}>{detail.project.project_no ?? detail.project.id}</Link> : "—"}
                </td></tr>
                <tr><th scope="row">{t("metaChannelBound")}</th><td>{label("channel", detail.channel)}</td></tr>
                <tr><th scope="row">{t("metaBundle")}</th><td>{detail.bundle}</td></tr>
                <tr><th scope="row">{t("colTime")}</th><td>{formatDateTime(detail.sent_at, locale)}</td></tr>
                <tr><th scope="row">{t("colRead")}</th><td>{detail.read_at ? t("read") : t("unread")}{detail.read_at ? ` · ${formatDateTime(detail.read_at, locale)}` : ""}</td></tr>
                <tr><th scope="row">{t("metaDedupe")}</th><td>{detail.dedupe_key ? <code className="font-mono text-[length:var(--fs-caption)]">{detail.dedupe_key}</code> : "—"}</td></tr>
                <tr><th scope="row">{t("metaSourceRef")}</th><td>{detail.source_ref ? <code className="font-mono text-[length:var(--fs-caption)]">{detail.source_ref}</code> : "—"}</td></tr>
              </tbody>
            </table>

            <details className="mt-3">
              <summary className="cursor-pointer text-[length:var(--fs-body)] font-semibold">{t("payloadSummary")}</summary>
              <pre className="mt-1 mb-0 overflow-auto rounded p-2 text-[length:var(--fs-caption)]" style={{ maxHeight: "18rem", background: "var(--muted-bg)" }} tabIndex={0} aria-label={t("payloadHeading")}>
                <code>{payloadText}</code>
              </pre>
            </details>

            <h3 className="mt-4 mb-1 text-[length:var(--fs-body)] font-semibold">{t("deliveryHeading")}</h3>
            {detail.deliveries.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] italic">{t("deliveryEmpty")}</p>
            ) : (
              <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                <table className="data-table list-table table-fixed-pct tmin-48">
                  <caption className="sr-only">{t("deliveryHeading")}</caption>
                  <ColGroup widths={DELIVERY_COL_PCT} />                  <thead>
                    <tr>
                      <th scope="col">{t("colChannel")}</th>
                      <th scope="col">{t("colRecipient")}</th>
                      <th scope="col">{t("colAttempt")}</th>
                      <th scope="col">{tc("status")}</th>
                      <th scope="col">{t("colNextAttempt")}</th>
                      <th scope="col">{t("errorToggle")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.deliveries.map((d) => <DeliveryRow key={d.id} d={d} />)}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 flex justify-end">
              <button type="button" className="btn-ghost" onClick={onClose}>{tc("close")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One delivery attempt row; the scrubbed last_error is expandable per row (default hidden). */
function DeliveryRow({ d }: { d: NotificationDeliveryRow }) {
  const t = useTranslations("admin.ops");
  const locale = useLocale();
  const label = useAdminLabel();
  // 수신자 표기: 이메일은 마스킹 주소, 웹훅은 target_key, 인앱 성격의 행은 사용자 ID — 전부 서버가 내려온 값 그대로.
  const recipient = d.recipient_address_masked ?? d.target_key ?? d.recipient_user_id ?? "—";
  return (
    <tr>
      <td>{label("channel", d.channel)}</td>
      <td className="cell-truncate"><code className="font-mono text-[length:var(--fs-caption)]">{recipient}</code>{d.is_test === 1 && <> <span className="status-chip status-gray">{t("isTestChip")}</span></>}</td>
      <td>{d.attempt}</td>
      <td><span className={deliveryStatusChipCls(d.status)}>{label("deliveryStatus", d.status)}</span></td>
      <td className="col-date cell-truncate">{d.next_attempt_at ? formatDateTime(d.next_attempt_at, locale) : "—"}</td>
      <td>
        {d.last_error ? (
          <details>
            <summary className="cursor-pointer text-[length:var(--fs-caption)]">{t("errorToggle")}</summary>
            <p className="m-0 mt-1 text-[length:var(--fs-caption)]" style={{ wordBreak: "break-all" }}>{d.last_error}</p>
          </details>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

function deliveryStatusChipCls(status: string): string {
  if (status === "sent") return "status-chip status-green";
  if (status === "failed") return "status-chip status-red";
  if (status === "pending" || status === "retry") return "status-chip status-amber";
  return "status-chip status-gray";
}
