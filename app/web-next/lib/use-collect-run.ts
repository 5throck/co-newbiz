"use client";

// useCollectRun — client side of the in-app "수집 실행" endpoints (POST starts a background run and answers
// 202; GET returns the latest run). Starts a run, polls GET until it leaves "running", and resumes an
// already-running run on mount. Shared by the WACC beta panel (KRX) and the WACC reference section (ECOS).
//
// A start answered 200 {status: "up_to_date", latest_date} (read-mostly collect endpoints, e.g. KOFIA) fetched nothing: the hook
// stays idle and exposes `upToDate` (the latest stored date) instead of polling.
//
// `onFinished` is called once per observed run completion (success or failure) so the caller can reload
// whatever the run feeds; it always sees the latest callback (ref), so closures over fresh state are safe.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.ts";
import { type BetaCollectRun, parseBetaCollectRun } from "./beta-collection-view.ts";

export type CollectPhase = "idle" | "starting" | "running" | "done" | "failed";

const POLL_MS = 3000;

export function useCollectRun(url: string, onFinished?: (run: BetaCollectRun) => void | Promise<void>) {
  const [phase, setPhase] = useState<CollectPhase>("idle");
  const [run, setRun] = useState<BetaCollectRun | null>(null);
  /** Localized message of a rejected start (ApiError text); null when the start was accepted. */
  const [startError, setStartError] = useState<string | null>(null);
  /** Envelope error code of a rejected start (e.g. "no_subject_company"); null when accepted or not an ApiError. */
  const [startErrorCode, setStartErrorCode] = useState<string | null>(null);
  /** Latest stored date when the last start was answered "up to date" (nothing was fetched); null otherwise. */
  const [upToDate, setUpToDate] = useState<string | null>(null);
  const alive = useRef(true);
  const polling = useRef(false);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const poll = useCallback(async () => {
    if (polling.current) return; // one poller at a time (strict-mode remounts, resume + click)
    polling.current = true;
    try {
      while (alive.current) {
        let latest: BetaCollectRun | null = null;
        try {
          latest = parseBetaCollectRun((await api.get<unknown>(url)).data);
        } catch {
          // transient — keep polling
        }
        if (!alive.current) return;
        if (latest && latest.status !== "running") {
          setRun(latest);
          setPhase(latest.status === "success" ? "done" : "failed");
          await finishedRef.current?.(latest);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    } finally {
      polling.current = false;
    }
  }, [url]);

  // Resume an in-flight run (page revisited / reloaded while a collection is still running).
  useEffect(() => {
    alive.current = true;
    setPhase("idle");
    setRun(null);
    setStartError(null);
    setStartErrorCode(null);
    setUpToDate(null);
    void (async () => {
      try {
        const latest = parseBetaCollectRun((await api.get<unknown>(url)).data);
        if (alive.current && latest?.status === "running") {
          setPhase("running");
          await poll();
        }
      } catch {
        // status probe is best-effort
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [url, poll]);

  const start = useCallback(async () => {
    setPhase("starting");
    setStartError(null);
    setStartErrorCode(null);
    setUpToDate(null);
    setRun(null);
    try {
      const res = await api.post<{ status?: string; latest_date?: string }>(url);
      if (res.data?.status === "up_to_date") {
        setUpToDate(res.data.latest_date ?? "");
        setPhase("idle");
        return;
      }
      setPhase("running");
    } catch (err) {
      if (err instanceof ApiError && err.code === "already_running") {
        setPhase("running"); // someone (or an earlier click) already started it — follow that run
      } else {
        setPhase("idle");
        setStartError(err instanceof ApiError ? err.message : "");
        setStartErrorCode(err instanceof ApiError ? err.code : null);
        return;
      }
    }
    await poll();
  }, [url, poll]);

  return { phase, run, startError, startErrorCode, upToDate, start, busy: phase === "starting" || phase === "running" };
}
