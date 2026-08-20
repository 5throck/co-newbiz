import { useEffect, useId, useState } from "react";
import { api, type NotificationRow } from "../api.ts";

// Notification-center entry — ui-spec.md §2's project-list node. One fetch
// on mount (no websocket, no polling loop). The notification table has no
// read/unread state, so the badge count is a recent-total and is labeled
// that way — never "읽지 않음", which the API cannot back today. Severity
// chips follow the workspace rule: icon + label + color together, never
// color alone.

const SEVERITY_META: Record<string, { icon: string; label: string; className: string }> = {
  opportunity: { icon: "●", label: "기회", className: "sev-opportunity" },
  warning: { icon: "▲", label: "주의", className: "sev-warning" },
  urgent: { icon: "■", label: "긴급", className: "sev-urgent" },
  info: { icon: "○", label: "안내", className: "sev-info" },
  ops: { icon: "◆", label: "운영", className: "sev-ops" },
};

const TRIGGER_LABEL: Record<string, string> = {
  rag_upgrade: "RAG 상향",
  rag_downgrade: "RAG 하향",
  kill_criteria: "킬크라이테리아",
  regulation_change: "규제 변경",
  threshold_breach: "임계값 초과",
  staleness: "데이터 갱신 필요",
  batch_failure: "배치 실패",
};

function SeverityChip({ severity }: { severity: string }) {
  const meta = SEVERITY_META[severity] ?? { icon: "○", label: severity, className: "sev-info" };
  return (
    <span className={`sev-chip ${meta.className}`}>
      <span aria-hidden="true">{meta.icon}</span> {meta.label}
    </span>
  );
}

// payload is a JSON string whose shape varies by trigger_type (watch-engine):
// rag transitions carry from_grade/to_grade, kill_criteria carries run_id.
// Anything unrecognized renders nothing rather than raw JSON.
function describePayload(payload: string): string {
  try {
    const p = JSON.parse(payload) as Record<string, unknown>;
    if (typeof p.from_grade === "string" && typeof p.to_grade === "string") {
      return `${p.from_grade} → ${p.to_grade}`;
    }
    if (typeof p.run_id === "string") return `실행 ${p.run_id}`;
    return "";
  } catch {
    return "";
  }
}

export function NotificationBell() {
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const popoverId = useId();

  useEffect(() => {
    api
      .get<NotificationRow[]>("/api/notifications")
      .then((res) => setRows(res.data))
      .catch(() => setFailed(true));
  }, []);

  const count = rows?.length ?? 0;

  return (
    <div className="notif-bell-wrap">
      <button
        type="button"
        className="notif-bell"
        aria-expanded={open}
        aria-describedby={open ? popoverId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        알림
        {rows !== null && (
          <span className={`notif-count${count === 0 ? " notif-count-zero" : ""}`} aria-hidden="true">
            {count}
          </span>
        )}
        <span className="sr-only">최근 알림 {count}건</span>
      </button>
      {open && (
        <div role="tooltip" id={popoverId} className="notif-popover">
          {failed ? (
            <p className="notif-meta">알림을 불러올 수 없습니다.</p>
          ) : rows === null ? (
            <p className="notif-meta">불러오는 중...</p>
          ) : rows.length === 0 ? (
            <p className="notif-meta">알림이 없습니다.</p>
          ) : (
            <ul className="notif-list">
              {rows.slice(0, 8).map((n, i) => {
                const detail = describePayload(n.payload);
                return (
                  <li key={`${n.project_id}-${n.sent_at}-${i}`} className="notif-item">
                    <div className="notif-item-head">
                      <SeverityChip severity={n.severity} />
                      <span className="notif-trigger">{TRIGGER_LABEL[n.trigger_type] ?? n.trigger_type}</span>
                    </div>
                    {detail && <p className="notif-detail">{detail}</p>}
                    <p className="notif-meta">
                      {new Date(n.sent_at).toLocaleString("ko-KR")} · 프로젝트 {n.project_id}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
