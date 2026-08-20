// API client — docs/api-spec.md §9's response envelope, consumed everywhere.
// The SPA never talks to the DB directly (ui-spec §7); this is the one file
// that knows the fetch/cookie/error-shape details so every page component
// only sees typed data.

export interface Envelope<T> {
  data: T;
  meta: Record<string, unknown>;
  error: { code: string; message: string } | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await res.json()) as Envelope<T>;
  if (!res.ok) {
    throw new ApiError(res.status, body.error?.code ?? "unknown_error", body.error?.message ?? "Request failed.");
  }
  return body;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export interface Me {
  userId: string;
  role: "admin" | "analyst" | "viewer";
  via: "cookie" | "bearer";
  scopes: string[];
  mustChangePassword: boolean;
}

export interface ProjectSummary {
  id: string;
  project_no: string;
  created_at: string;
}

export interface RagDimension {
  dimension: string;
  grade: "green" | "amber" | "red";
  triggered_rules: string;
  rationale: string;
  run_id: string;
  assessed_at: string;
}

export interface GlossaryTermSummary {
  key: string;
  ko: string;
  en: string;
  category: string;
}

export interface GlossaryTerm extends GlossaryTermSummary {
  definition_ko: string;
  why_it_matters_ko: string;
  aliases?: string[];
  related?: string[];
}

export interface ProcedureStep {
  id: number | string;
  gate: string;
  agent_key: string;
  skill_key: string;
  output_type: string;
  _source: "shared" | "region" | "entity";
}

export interface ResolvedProcedure {
  procedureKey: string;
  layersApplied: string[];
  steps: ProcedureStep[];
  thresholds: Record<string, unknown>;
}

export interface AdminUser {
  user_id: string;
  display_name: string | null;
  role: "admin" | "analyst" | "viewer";
  status: string;
  created_at: string;
  approved_at: string | null;
}

export interface AuditLogRow {
  id: string;
  actor_user_id: string;
  action: string;
  target: string;
  created_at: string;
}

export interface DataSourceRow {
  code: string;
  reliability_grade: string;
  key_var: string;
  key_present: boolean;
}
