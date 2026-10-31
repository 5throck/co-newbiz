// @version 1.0.0
/**
 * Email transport for notification delivery (ADR-0189/0190, scheduled-jobs design section 13.1, phase P3 row 2).
 *
 * SMTP only, configured entirely from env; a missing host or from disables the channel (isEmailConfigured false —
 * the delivery worker decides skip semantics, this module never invents an address). Every error that escapes this
 * module is pre-scrubbed through db/lib/secret-scrubber.ts so the NOTIFY_SMTP_PASS value can never appear in a
 * thrown message, a job_run.error row or a log line.
 *
 * Layering (design section 5): db/lib never imports scripts/ or app/web-next/lib. The prod check below therefore
 * duplicates the tiny resolveSchedulerEnv() logic of scripts/co-newbiz/scheduler-core.ts:37 on purpose — keep the
 * two strings in sync if the rule ever changes.
 *
 * MNPI: renderEmailBody accepts ONLY NotifyView — see the type's contract below.
 */
import nodemailer from "nodemailer";
import { scrubSecrets } from "../secret-scrubber.ts";

/**
 * The ONLY data shape the email and webhook transports may render (design section 13.1 content rule, ADR-0190
 * decision 6 — MNPI / FR-SEC). Email and webhook bodies carry title, severity, trigger, project code/name and a
 * deep link ONLY — never figures, valuations or document excerpts; the full notification payload stays in-app,
 * behind normal project permissions.
 *
 * This type is the enforcement point: renderEmailBody, formatSlack and formatTeams accept it and nothing else.
 * Do NOT widen it with payload/figure/document fields — widening it is the exfiltration path the security-engineer
 * review (design section 13.8) exists to block.
 */
export type NotifyView = {
  title: string;
  severity: "opportunity" | "warning" | "urgent" | "info" | "ops";
  triggerType: string;
  projectCode?: string;
  projectName?: string;
  deepLink?: string;
  locale?: "ko" | "en";
};

export type SmtpTlsMode = "starttls" | "tls" | "none";

export type EmailErrorCode =
  | "unconfigured" // NOTIFY_SMTP_HOST / NOTIFY_SMTP_FROM missing — caller records skipped: channel_unconfigured
  | "tls_refused_in_prod" // NOTIFY_SMTP_TLS=none with CO_NEWBIZ_SCHEDULER_ENV=prod
  | "aborted" // caller AbortSignal fired
  | "timeout" // connection or overall promise budget (> 10 s) exceeded
  | "smtp_retryable" // SMTP 4xx-class rejection or transient connection fault (design section 13.2: retry)
  | "smtp_terminal"; // SMTP 5xx-class rejection or permanent fault (design section 13.2: no retry)

/** Typed transport error. `message` is ALWAYS scrubbed (constructor runs scrubSecrets) — never build one by hand. */
export class EmailError extends Error {
  readonly code: EmailErrorCode;
  readonly retryable: boolean;

  constructor(code: EmailErrorCode, rawMessage: string, opts: { cause?: unknown } = {}) {
    // Pre-scrub before the message escapes: env secret values (NOTIFY_SMTP_PASS included) never appear in errors.
    super(scrubSecrets(`${code}: ${rawMessage}`), opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "EmailError";
    this.code = code;
    // Design section 13.2 policy: timeouts and 4xx/Transient faults retry; aborts are scheduler-level
    // (the delivery worker decides), permanent SMTP faults do not retry. Final retry policy is Row 3's.
    this.retryable = code === "smtp_retryable" || code === "timeout";
  }
}

/** resolveSchedulerEnv() equivalent, duplicated from scripts/ (layering rule — see module docstring). */
function schedulerEnv(env: Record<string, string | undefined>): "prod" | "dev" | null {
  const raw = env.CO_NEWBIZ_SCHEDULER_ENV;
  return raw === "prod" || raw === "dev" ? raw : null;
}

interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  tls: SmtpTlsMode;
}

function readSmtpConfig(env: Record<string, string | undefined>): SmtpConfig | null {
  const host = env.NOTIFY_SMTP_HOST?.trim();
  const from = env.NOTIFY_SMTP_FROM?.trim();
  if (!host || !from) return null;
  const portRaw = Number.parseInt(env.NOTIFY_SMTP_PORT?.trim() ?? "", 10);
  const tlsRaw = env.NOTIFY_SMTP_TLS?.trim().toLowerCase();
  const tls: SmtpTlsMode = tlsRaw === "tls" || tlsRaw === "none" ? tlsRaw : "starttls";
  return {
    host,
    port: Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 587,
    user: env.NOTIFY_SMTP_USER?.trim() || undefined,
    pass: env.NOTIFY_SMTP_PASS?.trim() || undefined,
    from,
    tls,
  };
}

/** True when host AND from are configured; false means the email channel is disabled (skip, not error). */
export function isEmailConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return readSmtpConfig(env) !== null;
}

/** Transport budget: design section 13.1 caps connection AND promise time at 10 s. */
export const EMAIL_TIMEOUT_MS = 10_000;

/**
 * Send one email. Throws EmailError on any failure (message pre-scrubbed); an unconfigured channel throws
 * EmailError("unconfigured") so the caller can record `skipped: channel_unconfigured`.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  signal: AbortSignal;
}): Promise<{ providerMessageId: string }> {
  if (opts.signal?.aborted) throw new EmailError("aborted", "aborted before connect");
  const cfg = readSmtpConfig(process.env);
  if (!cfg) throw new EmailError("unconfigured", "NOTIFY_SMTP_HOST and NOTIFY_SMTP_FROM must be set to send email");

  // NOTIFY_SMTP_TLS=none (cleartext SMTP) is refused when the scheduler runs in prod.
  if (cfg.tls === "none" && schedulerEnv(process.env) === "prod") {
    throw new EmailError("tls_refused_in_prod", "NOTIFY_SMTP_TLS=none is refused when CO_NEWBIZ_SCHEDULER_ENV=prod");
  }

  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    // tls = implicit TLS from the first byte (port 465); starttls = upgrade after greeting; none = cleartext
    // (dev/local stubs only — prod refusal above). opportunistic TLS below keeps server-advertised STARTTLS.
    secure: cfg.tls === "tls",
    requireTLS: cfg.tls === "starttls",
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    connectionTimeout: EMAIL_TIMEOUT_MS,
    greetingTimeout: EMAIL_TIMEOUT_MS,
    socketTimeout: EMAIL_TIMEOUT_MS,
  });

  // nodemailer has no AbortSignal option: bridge it by closing the transport on abort and racing a rejection.
  const onAbort = new Promise<never>((_, reject) => {
    opts.signal.addEventListener(
      "abort",
      () => {
        transport.close();
        reject(new EmailError("aborted", "aborted during send"));
      },
      { once: true },
    );
  });
  const budget = new Promise<never>((_, reject) => {
    const t = setTimeout(() => {
      transport.close();
      reject(new EmailError("timeout", `email send exceeded ${EMAIL_TIMEOUT_MS} ms budget`));
    }, EMAIL_TIMEOUT_MS);
    // Do not hold the event loop open just for the budget timer.
    t.unref?.();
  });

  try {
    const info = await Promise.race([
      transport.sendMail({
        from: cfg.from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      }),
      onAbort,
      budget,
    ]);
    return { providerMessageId: String(info.messageId ?? "") };
  } catch (err) {
    if (err instanceof EmailError) throw err;
    throw classifySmtpError(err);
  } finally {
    transport.close();
  }
}

/** Map a nodemailer failure to the typed codes; the message is scrubbed before escaping. */
function classifySmtpError(err: unknown): EmailError {
  const e = err as { code?: string; response?: string; message?: string };
  const raw = `${e?.response ?? ""} ${e?.message ?? String(err ?? "unknown smtp error")}`;
  // SMTP status line: "550 <...>" / "454 <...>" — 4xx = transient, 5xx = permanent (design section 13.2).
  const smtp = /\b([45]\d{2})\b/.exec(e?.response ?? "");
  if (smtp) {
    return new EmailError(smtp[1][0] === "4" ? "smtp_retryable" : "smtp_terminal", raw, { cause: err });
  }
  const code = e?.code ?? "";
  if (code === "ETIMEDOUT" || code === "ETIMEDOUTCONNECT" || code === "ESOCKETTIMEDOUT") {
    return new EmailError("timeout", raw, { cause: err });
  }
  if (["ECONNECTION", "ESOCKET", "ECONNCLOSED", "EDNS", "ECONNAUTH"].includes(code)) {
    return new EmailError("smtp_retryable", raw, { cause: err });
  }
  return new EmailError("smtp_terminal", raw, { cause: err });
}

/**
 * Mask a recipient address for storage/display (`j***@example.com`, design section 13.3): first character of the
 * local part + `***` + `@domain`. Degenerate inputs never echo the original: empty -> empty, no `@` -> `***`,
 * empty local part -> `***@domain`. notification_delivery stores ONLY this form.
 */
export function maskAddress(addr: string): string {
  const trimmed = addr.trim();
  if (!trimmed) return "";
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return "***";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

const SEVERITY_LABEL: Record<NotifyView["severity"], { ko: string; en: string }> = {
  opportunity: { ko: "기회", en: "Opportunity" },
  warning: { ko: "주의", en: "Warning" },
  urgent: { ko: "긴급", en: "Urgent" },
  info: { ko: "알림", en: "Info" },
  ops: { ko: "운영", en: "Ops" },
};

/** Shared by the digest renderer (scripts/co-newbiz/jobs/notify-digest.ts) — every interpolated value must pass through it. */
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/**
 * Render the email subject/text/html from a NotifyView. ko/en templates selected by view.locale (default ko);
 * plain text + minimal inline-styled HTML, no external assets. Only NotifyView fields may be interpolated —
 * the content rule (MNPI) forbids figures, valuations and document excerpts in email bodies.
 */
export function renderEmailBody(view: NotifyView): { subject: string; text: string; html: string } {
  const locale = view.locale === "en" ? "en" : "ko";
  const sev = SEVERITY_LABEL[view.severity]?.[locale] ?? view.severity;
  const project = [view.projectCode, view.projectName].filter(Boolean).join(" · ");
  const link = view.deepLink;

  if (locale === "en") {
    const subject = `[co-newbiz] ${sev}: ${view.title}`;
    const lines = [
      view.title,
      `Severity: ${sev} | Trigger: ${view.triggerType}`,
      project ? `Project: ${project}` : null,
      link ? `Open: ${link}` : null,
      "",
      "This notification carries no figures or document content. The full payload is visible in the app only.",
    ].filter((l): l is string => l !== null);
    const text = lines.join("\n");
    const html = [
      `<div style="font-family:sans-serif;font-size:14px;color:#1a1a1a">`,
      `<p style="margin:0 0 4px"><strong>${escapeHtml(view.title)}</strong></p>`,
      `<p style="margin:0 0 4px;color:#555">Severity: ${escapeHtml(sev)} &nbsp;|&nbsp; Trigger: ${escapeHtml(view.triggerType)}</p>`,
      project ? `<p style="margin:0 0 4px">Project: ${escapeHtml(project)}</p>` : null,
      link ? `<p style="margin:0 0 8px"><a href="${escapeHtml(link)}">Open in co-newbiz</a></p>` : null,
      `<p style="margin:0;color:#888;font-size:12px">No figures or document content are included. The full payload is visible in the app only.</p>`,
      `</div>`,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");
    return { subject, text, html };
  }

  const subject = `[co-newbiz] ${sev}: ${view.title}`;
  const lines = [
    view.title,
    `심각도: ${sev} | 트리거: ${view.triggerType}`,
    project ? `프로젝트: ${project}` : null,
    link ? `바로가기: ${link}` : null,
    "",
    "본 알림에는 수치나 문서 내용이 포함되지 않습니다. 전체 내용은 앱에서만 확인할 수 있습니다.",
  ].filter((l): l is string => l !== null);
  const text = lines.join("\n");
  const html = [
    `<div style="font-family:sans-serif;font-size:14px;color:#1a1a1a">`,
    `<p style="margin:0 0 4px"><strong>${escapeHtml(view.title)}</strong></p>`,
    `<p style="margin:0 0 4px;color:#555">심각도: ${escapeHtml(sev)} &nbsp;|&nbsp; 트리거: ${escapeHtml(view.triggerType)}</p>`,
    project ? `<p style="margin:0 0 4px">프로젝트: ${escapeHtml(project)}</p>` : null,
    link ? `<p style="margin:0 0 8px"><a href="${escapeHtml(link)}">co-newbiz에서 열기</a></p>` : null,
    `<p style="margin:0;color:#888;font-size:12px">수치·문서 내용은 포함되지 않습니다. 전체 내용은 앱에서만 확인할 수 있습니다.</p>`,
    `</div>`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
  return { subject, text, html };
}
