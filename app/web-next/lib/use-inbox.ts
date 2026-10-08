"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";
import { loadInbox, type InboxLoadResult } from "./inbox.ts";

/** Loads the inbox read model; reloads on window focus and every `pollMs` (0 = no polling). */
export function useInbox(pollMs = 0, enabled = true) {
  const [result, setResult] = useState<InboxLoadResult | null>(null);
  const [loading, setLoading] = useState(enabled);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const r = await loadInbox((p) => api.get(p));
    setResult(r);
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    const timer = pollMs > 0 ? window.setInterval(() => void reload(), pollMs) : null;
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [enabled, pollMs, reload]);

  return { result, loading, reload };
}
