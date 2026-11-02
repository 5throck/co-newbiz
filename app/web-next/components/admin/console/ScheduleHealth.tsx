"use client";

// Scheduler health surface (design 2026-10-29-scheduled-jobs-design §4.1 health row, §4.2
// banner, §6 SRE rules b+c): the tick-heartbeat banner (poll on mount + every 60 s — a
// lightweight admin-only read) and the per-job chips (overdue / consecutive failures) the
// list merges into its rows from the same payload.
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type ScheduleHealth, type ScheduleHealthJob } from "../../../lib/api.ts";

// §4.2: poll on mount + every 60 s. The GET is a heartbeat read (two tiny SQLite queries
// server-side), not a job trigger — the cadence stays passive.
const HEALTH_POLL_MS = 60_000;

/**
 * Polls GET /api/admin/schedule-jobs/health while `enabled`. A failed poll keeps the last
 * state (the banner and the chips are advisory — they must not take the whole section down),
 * and the interval only runs while the schedule section is mounted.
 */
export function useScheduleHealth(enabled: boolean): ScheduleHealth | null {
  const [health, setHealth] = useState<ScheduleHealth | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      api
        .get<ScheduleHealth>("/api/admin/schedule-jobs/health")
        .then((r) => {
          if (!cancelled) setHealth(r.data);
        })
        .catch(() => undefined);
    };
    load();
    const id = setInterval(load, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);
  return health;
}

/** job_key → health row lookup for the list render. */
export function useScheduleHealthMap(health: ScheduleHealth | null): Map<string, ScheduleHealthJob> {
  return useMemo(() => new Map((health?.jobs ?? []).map((h) => [h.job_key, h])), [health]);
}

/**
 * §4.2 health banner: shown when the tick heartbeat is stale (the server's `healthy` flag —
 * age > 180 s or no heartbeat row at all). The runbook path stays plain text: the /library
 * view renders docs/runbooks/scheduler.md for the actual procedure.
 */
export function ScheduleHealthBanner({ tick }: { tick: ScheduleHealth["tick"] }) {
  const t = useTranslations("admin.ops");
  if (tick.healthy) return null;
  return (
    <div
      role="alert"
      className="mb-3 flex flex-col gap-[0.15rem] border border-[color:var(--amber-border)] bg-[color:var(--amber-bg)] px-3 py-2 text-[color:var(--amber-fg)]"
    >
      <span className="text-[length:var(--fs-body)] font-semibold">
        <span aria-hidden="true">▲</span> {t("healthBannerTitle")}
      </span>
      <span className="text-[length:var(--fs-caption)]">
        {t("healthBannerBody")} <code className="font-mono">docs/runbooks/scheduler.md</code>
      </span>
    </div>
  );
}

/**
 * Per-job health chips (§4.2 list merge): `overdue` → warning chip, `consecutive_failures
 * >= 3` → danger chip — text + glyph, never colour alone (FR-SYS-05). Absent when the health
 * payload has no row for the job yet (first render before the first poll).
 */
export function ScheduleJobHealthChips({ h }: { h: ScheduleHealthJob | undefined }) {
  const t = useTranslations("admin.ops");
  if (!h) return null;
  return (
    <>
      {h.overdue && (
        <span className="status-chip status-amber">
          <span aria-hidden="true">▲</span> {t("chipOverdue")}
        </span>
      )}
      {h.consecutive_failures >= 3 && (
        <span className="status-chip status-red">
          <span aria-hidden="true">!</span> {t("chipConsecutiveFailures", { n: h.consecutive_failures })}
        </span>
      )}
    </>
  );
}
