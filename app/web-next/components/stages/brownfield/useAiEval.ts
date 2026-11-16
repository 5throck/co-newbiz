"use client";

// S6 bulk AI evaluation run state (ADR-0199 A1-A4): loads the latest run, polls every 3 s only while it is `running`,
// and starts / resumes / cancels it. Drafting is a proposal — nothing here writes a verdict or touches ranking.
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../../lib/api.ts";
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lastDone = useRef(0);

  const callError = useCallback(
    (e: unknown): string => {
      if (e instanceof ApiError) {
        return (KNOWN_CALL_ERRORS as readonly string[]).includes(e.code) ? t(`callErrors.${e.code}`) : e.message;
      }
      return e instanceof Error ? e.message : t("callErrors.unknown");
    },
    [t],
  );

  const refresh = useCallback(async () => {
    if (!oppId) return;
    try {
      const r = await api.get<RunProgressView>(`/api/brownfield/${encodeURIComponent(oppId)}/eval-draft-runs/latest`);
      setView(r.data);
    } catch (e) {
      setMessage(callError(e));
    }
  }, [oppId, callError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const status = view?.run?.status;
  const done = view?.progress.done ?? 0;

  // Poll only while the run is `running` (paused / interrupted runs wait for a manual resume; no timer).
  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => void refresh(), AI_EVAL_POLL_MS);
    return () => window.clearInterval(id);
  }, [status, refresh]);

  // Refresh the longlist chips whenever another candidate finished and once more when the run stops running.
  useEffect(() => {
    if (!oppId) return;
    if (done !== lastDone.current) {
      lastDone.current = done;
      if (done > 0) loadDetail(oppId);
    }
  }, [done, oppId, loadDetail]);
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (oppId && prevStatus.current === "running" && status !== "running") loadDetail(oppId);
    prevStatus.current = status;
  }, [status, oppId, loadDetail]);

  async function call(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setMessage(callError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const base = oppId ? `/api/brownfield/${encodeURIComponent(oppId)}/eval-draft-runs` : "";
  return {
    view,
    busy,
    message,
    start: (o: StartOptions, targetIds?: string[]) => call(() => api.post(base, buildStartBody(o, targetIds))),
    resume: (runId: string) => call(() => api.post(`${base}/${encodeURIComponent(runId)}/resume`, {})),
    cancel: (runId: string) => call(() => api.post(`${base}/${encodeURIComponent(runId)}/cancel`, {})),
  };
}
