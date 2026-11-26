"use client";

// useGenerationRun — client side of the S8 background generation (POST .../business-case/generate answers
// 202 and the chain runs on the server, detached from the page). Restores an in-flight run on mount (page
// reloaded / revisited while it runs), starts a run, polls the latest-run view every few seconds until it is
// over, and reports completion once so the caller can reload what the run produced. Polling stops on unmount
// and on a terminal state; nothing here owns the work — a refresh only loses the poller, never the run.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.ts";
import { type GenerationRun, isRunInProgress, parseGenerationRun } from "./business-case-generation-view.ts";

export type GenerationPhase = "idle" | "starting" | "running" | "done" | "failed";

const POLL_MS = 2500;
/** A failed latest run is surfaced on page load only while it is this fresh (older failures are history). */
const FAILED_RUN_SURFACE_MS = 24 * 60 * 60 * 1000;

export function useGenerationRun(projectId: string, onFinished?: (run: GenerationRun) => void | Promise<void>) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/business-case/generate`;
  const [phase, setPhase] = useState<GenerationPhase>("idle");
  const [run, setRun] = useState<GenerationRun | null>(null);
  /** Message of a rejected start (ApiError text); null when the start was accepted. */
  const [startError, setStartError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const alive = useRef(true);
  const polling = useRef(false);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const readLatest = useCallback(async (): Promise<GenerationRun | null> => {
    const res = await api.get<{ run: unknown }>(base);
    return parseGenerationRun(res.data?.run);
  }, [base]);

  const poll = useCallback(async () => {
    if (polling.current) return; // one poller at a time (strict-mode remounts, resume + click)
    polling.current = true;
    try {
      while (alive.current) {
        let latest: GenerationRun | null = null;
        try {
          latest = await readLatest();
        } catch {
          // transient (tunnel hiccup, server busy) — keep polling
        }
        if (!alive.current) return;
        if (latest) setRun(latest);
        if (latest && !isRunInProgress(latest)) {
          setPhase(latest.status === "done" ? "done" : "failed");
          await finishedRef.current?.(latest);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    } finally {
      polling.current = false;
    }
  }, [readLatest]);

  // Resume an in-flight run; surface the latest run when it failed (e.g. a server restart mid-run).
  useEffect(() => {
    alive.current = true;
    setPhase("idle");
    setRun(null);
    setStartError(null);
    void (async () => {
      try {
        const latest = await readLatest();
        if (!alive.current || !latest) return;
        if (isRunInProgress(latest)) {
          setRun(latest);
          setPhase("running");
          await poll();
        } else if (
          latest.status === "failed" &&
          Date.now() - Date.parse(latest.finished_at ?? latest.started_at) < FAILED_RUN_SURFACE_MS
        ) {
          setRun(latest);
          setPhase("failed");
        }
      } catch {
        // the status probe is best-effort
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [readLatest, poll]);

  // Tick the running activity's clock between polls.
  useEffect(() => {
    if (phase !== "starting" && phase !== "running") return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const start = useCallback(
    async (regenerate = false) => {
      if (phase === "starting" || phase === "running") return;
      setPhase("starting");
      setStartError(null);
      setRun(null);
      try {
        const r = await api.post<{ runId: string; alreadyRun?: boolean }>(base, regenerate ? { regenerate: true } : {});
        // IA cleanup 2026-10-14: ONE generate entry — when the first press reports an existing run, the SAME
        // press escalates to `regenerate: true`, so a second entry point is not needed.
        if (!regenerate && r.data.alreadyRun) await api.post(base, { regenerate: true });
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "already_running")) {
          setPhase("idle");
          setStartError(err instanceof ApiError ? err.message : "");
          return;
        }
        // someone (or an earlier press / another tab) already started it — follow that run
      }
      setPhase("running");
      await poll();
    },
    [base, phase, poll],
  );

  return { phase, run, startError, nowMs, start, busy: phase === "starting" || phase === "running" };
}
