"use client";

// Create dialog for the watch management panel (§13.6) — extracted from WatchesSection.tsx
// (2026-11 coverage-gate file-length split; the ScheduleCreateDialog.tsx precedent). One watch
// per (project, user); the server 409 watch_exists renders inline. The project is picked by
// NAME or number through /api/admin/project-options (2026-11-27 user request; relaxes the old
// ID-only naming, see the route's FR-SEC-02 note).
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type AdminUser } from "../../../lib/api.ts";
import { useToast } from "../../ui.tsx";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";

interface ProjectOption {
  id: string;
  project_no: string;
  project_name: string | null;
}

export function WatchCreateDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("admin.watches");
  const ta = useTranslations("admin.actions");
  const tc = useTranslations("common");
  const { toast } = useToast();
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [projectId, setProjectId] = useState("");
  const [projectLabel, setProjectLabel] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [projectOptions, setProjectOptions] = useState<ProjectOption[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced project search by number or name — /api/admin/project-options.
  useEffect(() => {
    const q = projectQuery.trim();
    if (q === "") {
      setProjectOptions(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<ProjectOption[]>(`/api/admin/project-options?q=${encodeURIComponent(q)}`)
        .then((res) => {
          if (!cancelled) setProjectOptions(res.data);
        })
        .catch(() => {
          if (!cancelled) setProjectOptions([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectQuery]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AdminUser[]>("/api/admin/users")
      .then((res) => {
        if (!cancelled) setUsers(res.data.filter((u) => u.status === "active"));
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canSubmit = projectId.trim() !== "" && userId.trim() !== "" && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/watches", { project_id: projectId.trim(), user_id: userId.trim() });
      toast(ta("watchCreated"));
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "watch_exists") setError(t("createExists"));
      else setError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("createAria")} onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel" style={{ maxWidth: "30rem", width: "100%" }}>
        <div className="modal-head">
          <h2>{t("createAria")}</h2>
        </div>
        <form
          onSubmit={(e) => {
            void submit(e);
          }}
          aria-label={t("createAria")}
          className="stack-form mt-2"
        >
          <div className="stack-form-row">
            <label htmlFor="watchProjectSearch">{t("createProjectLabel")}</label>
            {projectId === "" ? (
              <input
                id="watchProjectSearch"
                type="search"
                className="sizing-new-input"
                value={projectQuery}
                onChange={(e) => {
                  setProjectQuery(e.target.value);
                  setProjectLabel("");
                }}
                autoComplete="off"
                aria-describedby="watchProjectHint"
                placeholder={t("createProjectSearchPlaceholder")}
                required
              />
            ) : (
              <input
                id="watchProject"
                className="sizing-new-input font-mono"
                value={projectLabel}
                readOnly
                aria-describedby="watchProjectHint"
              />
            )}
            {projectId === "" && projectOptions !== null && (
              <ul
                className="mt-1 list-none p-0 m-0 border border-[color:var(--border)] rounded-lg max-h-40 overflow-y-auto"
                aria-label={t("createProjectLabel")}
              >
                {projectOptions.length === 0 ? (
                  <li className="px-2 py-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                    {t("createProjectNoMatch")}
                  </li>
                ) : (
                  projectOptions.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="block w-full text-left px-2 py-1 hover:bg-[color:var(--muted-bg)]"
                        onClick={() => {
                          setProjectId(p.id);
                          setProjectLabel(p.project_name ? `${p.project_no} · ${p.project_name}` : p.project_no);
                        }}
                      >
                        <span className="font-mono text-[length:var(--fs-caption)]">{p.project_no}</span>
                        {p.project_name ? (
                          <span className="ml-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                            {p.project_name}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
            <p id="watchProjectHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("createProjectHint")}
            </p>
          </div>
          <div className="stack-form-row">
            <label htmlFor="watchUser">{t("createUserLabel")}</label>
            <select
              id="watchUser"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              aria-describedby="watchUserHint"
              required
            >
              <option value="" disabled>
                —
              </option>
              {(users ?? []).map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.user_id}
                  {u.display_name ? ` (${u.display_name})` : ""}
                </option>
              ))}
            </select>
            <p id="watchUserHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("createUserHint")}
            </p>
          </div>
          {error !== null && (
            <p role="alert" className="m-0 text-[length:var(--fs-body)] text-[color:var(--red-fg)]">
              {error}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              {tc("cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {busy ? tc("saving") : tc("register")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
