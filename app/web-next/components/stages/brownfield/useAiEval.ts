"use client";

// S6 AI evaluation run state (ADR-0199 A1-A4, queue model ADR-0200 part B). Two views of the server:
//  - `activeRuns`: every run registered with the dispatcher (GET /eval-draft-runs/active), polled every 3 s only while
//    non-empty and cleared on unmount;
//  - `view`: the latest run (GET /eval-draft-runs/latest), which drives the paused / interrupted / resume panel.
// Starts / resumes / cancels refresh both. Drafting is a proposal — nothing here writes a verdict or touches ranking.
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../../lib/api.ts";
import { finishedRunIds } from "./aiEvalActive.ts";
import { errorParams, formatStartNotice, summarizeStart, type StartResponse } from "./aiEvalQueueState.ts";
import { KNOWN_CALL_ERRORS, type RunProgressView } from "./aiEvalTypes.ts";

export const AI_EVAL_POLL_MS = 3000;

export interface StartOptions {
  categories: "both" | "financial" | "technical";
  web_evidence: boolean;
  force_refresh: boolean;
}

/** Start-route body: `target_ids` is sent only for a scoped (per-candidate) run. */
export function buildStartBody(o: StartOptions, targetIds?: string[]) {
  return targetIds ? { ...o, target_ids: targetIds } : o;
}

export function useAiEval({ oppId, loadDetail }: { oppId: string | null; loadDetail: (oppId: string) => void }) {
  const t = useTranslations("stages.s67.aiEval");
  const [view, setView] = useState<RunProgressView | null>(null);
  const [activeRuns, setActiveRuns] = useState<RunProgressView[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Result of the last start (queued / skipped counts and reasons): information, not an error. */
  const [notice, setNotice] = useState<string | null>(null);
  const lastDone = useRef(0);
  const prevIds = useRef<string[]>([]);

  const callError = useCallback(
    (e: unknown): string => {
      if (e instanceof ApiError) {
        return (KNOWN_CALL_ERRORS as readonly string[]).includes(e.code)
          ? t(`callErrors.${e.code}`, errorParams(e.details))
          : e.message;
      }
      return e instanceof Error ? e.message : t("callErrors.unknown");
    },
    [t],
  );

  const base = oppId ? `/api/brownfield/${encodeURIComponent(oppId)}/eval-draft-runs` : "";

  const refreshLatest = useCallback(async () => {
    if (!base) return;
    try {
      const r = await api.get<RunProgressView>(`${base}/latest`);
      setView(r.data);
    } catch (e) {
      setMessage(callError(e));
    }
  }, [base, callError]);

  const refreshActive = useCallback(async () => {
    if (!base) return;
    try {
      const r = await api.get<{ runs: RunProgressView[] }>(`${base}/active`);
      setActiveRuns(r.data.runs ?? []);
    } catch (e) {
      setMessage(callError(e));
    }
  }, [base, callError]);

  const refresh = useCallback(() => Promise.all([refreshLatest(), refreshActive()]), [refreshLatest, refreshActive]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasActive = activeRuns.length > 0;
  // Poll only while at least one run is engine-active (paused / interrupted runs wait for a manual resume; no timer).
  useEffect(() => {
    if (!hasActive) return;
    const id = window.setInterval(() => void refreshActive(), AI_EVAL_POLL_MS);
    return () => window.clearInterval(id);
  }, [hasActive, refreshActive]);

  // Refresh the longlist chips whenever any candidate finished, and when a run leaves the active set (it may have
  // completed, paused or failed: the latest-run panel is reloaded too).
  const done = activeRuns.reduce((n, v) => n + v.progress.done, 0);
  useEffect(() => {
    if (!oppId) return;
    if (done !== lastDone.current) {
      lastDone.current = done;
      if (done > 0) loadDetail(oppId);
    }
  }, [done, oppId, loadDetail]);
  useEffect(() => {
    const ids = activeRuns.flatMap((v) => (v.run ? [v.run.id] : []));
    const finished = finishedRunIds(prevIds.current, ids);
    prevIds.current = ids;
    if (oppId && finished.length > 0) {
      loadDetail(oppId);
      void refreshLatest();
    }
  }, [activeRuns, oppId, loadDetail, refreshLatest]);

  async function call(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    setNotice(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setMessage(callError(e));
      void refresh(); // a refused call usually means the queue changed under us (e.g. a queued item started meanwhile)
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    view,
    activeRuns,
    busy,
    message,
    notice,
    start: (o: StartOptions, targetIds?: string[]) =>
      call(async () => {
        const r = await api.post<StartResponse>(base, buildStartBody(o, targetIds));
        setNotice(formatStartNotice(t, summarizeStart(r.data)));
      }),
    /** Cancel one waiting item (A4b). A 409 `item_running` is reported by `message` after the lists refresh. */
    cancelItem: (runId: string, itemId: string) =>
      call(() => api.post(`${base}/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/cancel`, {})),
    resume: (runId: string) => call(() => api.post(`${base}/${encodeURIComponent(runId)}/resume`, {})),
    cancel: (runId: string) => call(() => api.post(`${base}/${encodeURIComponent(runId)}/cancel`, {})),
  };
}
