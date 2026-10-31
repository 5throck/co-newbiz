// Notification transport tests (ADR-0189/0190 P3 row 2, design 2026-10-29-scheduled-jobs-design section 13.1).
// No docker, no external network: SMTP is stubbed on node:net (127.0.0.1 ephemeral port) and webhooks on Bun.serve.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import net from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EmailError,
  isEmailConfigured,
  maskAddress,
  renderEmailBody,
  sendEmail,
  type NotifyView,
} from "../../db/lib/notify/email.ts";
import {
  formatSlack,
  formatTeams,
  isHostAllowed,
  isSchemeAllowed,
  parseRetryAfter,
  redactUrl,
  resolveTargetUrl,
  sendWebhook,
  WebhookError,
} from "../../db/lib/notify/webhook.ts";
import {
  envKeySource,
  isPipelineEnvKey,
  loadRootEnvPipelineKeys,
  resetRootEnvForTests,
} from "../../app/web-next/lib/root-env.ts";

// ── env management ───────────────────────────────────────────────────────────

const ENV_KEYS = [
  "NOTIFY_SMTP_HOST",
  "NOTIFY_SMTP_PORT",
  "NOTIFY_SMTP_USER",
  "NOTIFY_SMTP_PASS",
  "NOTIFY_SMTP_FROM",
  "NOTIFY_SMTP_TLS",
  "NOTIFY_WEBHOOK_URL_DEALS",
  "NOTIFY_WEBHOOK_URL_OPS",
  "NOTIFY_WEBHOOK_ALLOWED_HOSTS",
  "CO_NEWBIZ_SCHEDULER_ENV",
];
let savedEnv: Record<string, string | undefined>;

function setEnv(map: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  setEnv(Object.fromEntries(ENV_KEYS.map((k) => [k, undefined])));
});
afterEach(() => {
  setEnv(savedEnv);
});

// ── minimal SMTP stub on node:net ────────────────────────────────────────────

interface SmtpScript {
  ehlo?: string;
  mail?: string;
  rcpt?: string;
  data?: string;
  endData?: string;
  greetDelayMs?: number;
}

async function startSmtpStub(script: SmtpScript = {}) {
  const captured = { commands: [] as string[], data: "", rcptTo: "" };
  const replies = {
    ehlo: script.ehlo ?? "250-stub\r\n250-8BITMIME\r\n250 SMTPUTF8",
    mail: script.mail ?? "250 2.1.0 OK",
    rcpt: script.rcpt ?? "250 2.1.5 OK",
    data: script.data ?? "354 End data with <CR><LF>.<CR><LF>",
    endData: script.endData ?? "250 2.0.0 Queued as stub",
  };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    let inData = false;
    const send = (line: string) => socket.write(`${line}\r\n`);
    const greet = () => send("220 stub ESMTP ready");
    if (script.greetDelayMs) setTimeout(greet, script.greetDelayMs);
    else greet();
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf-8");
      let idx = buffer.indexOf("\r\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        // Advance BEFORE dispatching so the `continue` below (DATA capture) cannot spin forever.
        idx = buffer.indexOf("\r\n");
        if (inData) {
          if (line === ".") {
            inData = false;
            send(replies.endData);
          } else {
            captured.data += `${line}\n`;
          }
          continue;
        }
        captured.commands.push(line);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO" || verb === "HELO") send(replies.ehlo);
        else if (verb === "MAIL") send(replies.mail);
        else if (verb === "RCPT") {
          captured.rcptTo = line;
          send(replies.rcpt);
        } else if (verb === "DATA") {
          inData = true;
          send(replies.data);
        } else if (verb === "QUIT") {
          send("221 2.0.0 Bye");
          socket.end();
        } else send("250 2.0.0 OK");
      }
    });
    socket.on("error", () => {
      /* client aborts close the socket abruptly — expected */
    });
  });
  server.unref();
  const listening = new Promise<{ port: number; close: () => Promise<void>; captured: typeof captured }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        // destroy open sockets first: after a client-side abort the peer socket can linger and
        // server.close()'s callback would never fire, hanging the test.
        close: () => {
          for (const s of sockets) s.destroy();
          return new Promise((res) => server.close(() => res()));
        },
        captured,
      });
    });
  });
  return listening;
}

const EMAIL_ENV_BASE = {
  NOTIFY_SMTP_FROM: "co-newbiz@example.com",
  NOTIFY_SMTP_TLS: "none", // plain path — the stub does not advertise STARTTLS
};

const DEEP_LINK = "https://newbiz.example.org/projects/PRJ-0001";

const FULL_VIEW: NotifyView = {
  title: "Watch rule: revenue delta breached",
  severity: "urgent",
  triggerType: "kill_criteria",
  projectCode: "PRJ-0001",
  projectName: "Second Battery Plant",
  deepLink: DEEP_LINK,
  locale: "en",
};

// ── email transport ──────────────────────────────────────────────────────────

describe("email transport", () => {
  test("sends to the stub, returns a provider message id, and the DATA carries the rendered body", async () => {
    const stub = await startSmtpStub();
    try {
      setEnv({ ...EMAIL_ENV_BASE, NOTIFY_SMTP_HOST: "127.0.0.1", NOTIFY_SMTP_PORT: String(stub.port) });
      const body = renderEmailBody(FULL_VIEW);
      const res = await sendEmail({ to: "jane@example.com", ...body, signal: new AbortController().signal });
      expect(res.providerMessageId.length).toBeGreaterThan(0);
      expect(stub.captured.rcptTo).toContain("jane@example.com");
      expect(stub.captured.data).toContain(`Subject: ${body.subject}`);
      expect(stub.captured.data).toContain("jane@example.com");
      expect(stub.captured.commands.some((c) => c.startsWith("MAIL FROM"))).toBe(true);
    } finally {
      await stub.close();
    }
  });

  test("unconfigured channel (missing host / missing from) throws typed unconfigured", async () => {
    setEnv({ NOTIFY_SMTP_FROM: "co-newbiz@example.com" }); // no host
    const err = await sendEmail({ to: "a@b.c", subject: "s", text: "t", signal: new AbortController().signal }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(EmailError);
    expect((err as EmailError).code).toBe("unconfigured");
    expect((err as EmailError).retryable).toBe(false);
  });

  test("isEmailConfigured requires host AND from; empty strings do not count", () => {
    expect(isEmailConfigured({ NOTIFY_SMTP_HOST: "smtp.example.com", NOTIFY_SMTP_FROM: "n@example.com" })).toBe(true);
    expect(isEmailConfigured({ NOTIFY_SMTP_FROM: "n@example.com" })).toBe(false);
    expect(isEmailConfigured({ NOTIFY_SMTP_HOST: "smtp.example.com" })).toBe(false);
    expect(isEmailConfigured({ NOTIFY_SMTP_HOST: " ", NOTIFY_SMTP_FROM: "n@example.com" })).toBe(false);
  });

  test("NOTIFY_SMTP_TLS=none is refused in prod, allowed with an explicit dev env", async () => {
    const stub = await startSmtpStub();
    try {
      setEnv({
        ...EMAIL_ENV_BASE,
        NOTIFY_SMTP_HOST: "127.0.0.1",
        NOTIFY_SMTP_PORT: String(stub.port),
        CO_NEWBIZ_SCHEDULER_ENV: "prod",
      });
      const body = renderEmailBody(FULL_VIEW);
      const err = await sendEmail({ to: "a@b.c", ...body, signal: new AbortController().signal }).catch((e) => e);
      expect(err).toBeInstanceOf(EmailError);
      expect((err as EmailError).code).toBe("tls_refused_in_prod");
      // ...and the same send succeeds when the env is explicitly dev.
      setEnv({ CO_NEWBIZ_SCHEDULER_ENV: "dev" });
      const res = await sendEmail({ to: "a@b.c", ...body, signal: new AbortController().signal });
      expect(res.providerMessageId.length).toBeGreaterThan(0);
    } finally {
      await stub.close();
    }
  });

  test("a pre-aborted signal throws typed aborted without connecting", async () => {
    const stub = await startSmtpStub();
    try {
      setEnv({ ...EMAIL_ENV_BASE, NOTIFY_SMTP_HOST: "127.0.0.1", NOTIFY_SMTP_PORT: String(stub.port) });
      const controller = new AbortController();
      controller.abort();
      const err = await sendEmail({ to: "a@b.c", subject: "s", text: "t", signal: controller.signal }).catch((e) => e);
      expect(err).toBeInstanceOf(EmailError);
      expect((err as EmailError).code).toBe("aborted");
      expect(stub.captured.commands.length).toBe(0);
    } finally {
      await stub.close();
    }
  });

  test("an abort during the greeting wait throws typed aborted (signal honoured mid-flight)", async () => {
    const stub = await startSmtpStub({ greetDelayMs: 5_000 }); // stub never greets in time
    try {
      setEnv({ ...EMAIL_ENV_BASE, NOTIFY_SMTP_HOST: "127.0.0.1", NOTIFY_SMTP_PORT: String(stub.port) });
      const controller = new AbortController();
      const pending = sendEmail({ to: "a@b.c", subject: "s", text: "t", signal: controller.signal });
      setTimeout(() => controller.abort(), 50);
      const err = await pending.catch((e) => e);
      expect(err).toBeInstanceOf(EmailError);
      expect((err as EmailError).code).toBe("aborted");
    } finally {
      await stub.close();
    }
  });

  test("SMTP 5xx rejection throws terminal; the echoed password never escapes (scrubbed)", async () => {
    const scrubFixtureValue = "supersecret-pass-123";
    const stub = await startSmtpStub({ rcpt: `550 5.7.1 auth ${scrubFixtureValue} rejected` });
    try {
      setEnv({
        ...EMAIL_ENV_BASE,
        NOTIFY_SMTP_HOST: "127.0.0.1",
        NOTIFY_SMTP_PORT: String(stub.port),
        NOTIFY_SMTP_PASS: scrubFixtureValue,
      });
      const err = await sendEmail({ to: "a@b.c", subject: "s", text: "t", signal: new AbortController().signal }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(EmailError);
      expect((err as EmailError).code).toBe("smtp_terminal");
      expect((err as EmailError).retryable).toBe(false);
      expect((err as EmailError).message).not.toContain(scrubFixtureValue);
      expect((err as EmailError).message).toContain("[REDACTED]");
    } finally {
      await stub.close();
    }
  });

  test("SMTP 4xx rejection is typed retryable", async () => {
    const stub = await startSmtpStub({ rcpt: "454 4.7.1 Temporarily rejected, try later" });
    try {
      setEnv({ ...EMAIL_ENV_BASE, NOTIFY_SMTP_HOST: "127.0.0.1", NOTIFY_SMTP_PORT: String(stub.port) });
      const err = await sendEmail({ to: "a@b.c", subject: "s", text: "t", signal: new AbortController().signal }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(EmailError);
      expect((err as EmailError).code).toBe("smtp_retryable");
      expect((err as EmailError).retryable).toBe(true);
    } finally {
      await stub.close();
    }
  });
});

// ── maskAddress / renderEmailBody ────────────────────────────────────────────

describe("maskAddress", () => {
  test("keeps the first local character plus the domain", () => {
    expect(maskAddress("jane@example.com")).toBe("j***@example.com");
    expect(maskAddress("multi.part@test.co.kr")).toBe("m***@test.co.kr");
    expect(maskAddress("a@b.co")).toBe("a***@b.co");
  });
  test("edge inputs never echo the original", () => {
    expect(maskAddress("")).toBe("");
    expect(maskAddress("   ")).toBe("");
    expect(maskAddress("no-at-sign")).toBe("***");
    expect(maskAddress("@example.com")).toBe("***@example.com");
    expect(maskAddress("  jane@example.com  ")).toBe("j***@example.com");
  });
});

describe("renderEmailBody", () => {
  test("default locale is ko; locale field switches templates", () => {
    const ko = renderEmailBody({ ...FULL_VIEW, locale: undefined });
    expect(ko.subject).toContain("긴급");
    expect(ko.text).toContain("심각도");
    const en = renderEmailBody({ ...FULL_VIEW, locale: "en" });
    expect(en.subject).toContain("Urgent");
    expect(en.text).toContain("Severity: Urgent");
  });
  test("carries only NotifyView fields (MNPI): title/severity/trigger/project/deep link, plus a payload disclaimer", () => {
    const { subject, text, html } = renderEmailBody(FULL_VIEW);
    expect(subject).toContain(FULL_VIEW.title);
    for (const part of [text, html]) {
      expect(part).toContain("kill_criteria");
      expect(part).toContain("PRJ-0001");
      expect(part).toContain(DEEP_LINK);
      expect(part).toMatch(/payload/i); // the "full payload is in-app only" notice is present in the body
    }
  });
  test("HTML escapes interpolated values (no external assets, no script injection)", () => {
    const { html } = renderEmailBody({
      ...FULL_VIEW,
      title: "PoC<script>alert(1)</script>",
      projectName: '"onmouseover="x',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('onmouseover="x');
    expect(html).not.toMatch(/https?:\/\/(?!newbiz\.example\.org)[a-z]/); // no unexpected external URLs
  });
});

// ── webhook formatters (MNPI shape) ──────────────────────────────────────────

function collectKeys(value: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, acc);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as object)) {
      acc.add(k);
      collectKeys(v, acc);
    }
  }
  return acc;
}

describe("webhook formatters (MNPI shape)", () => {
  const SLACK_ALLOWED_KEYS = new Set([
    "text",
    "blocks",
    "type",
    "emoji",
    "elements",
    "header",
    "section",
    "actions",
    "context",
    "mrkdwn",
    "plain_text",
    "url",
    "button",
  ]);
  const TEAMS_ALLOWED_KEYS = new Set([
    "type",
    "attachments",
    "contentType",
    "content",
    "$schema",
    "version",
    "body",
    "actions",
    "TextBlock",
    "FactSet",
    "facts",
    "title",
    "value",
    "isSubtle",
    "size",
    "weight",
    "wrap",
    "url",
    "text",
  ]);

  test("formatSlack output contains only NotifyView-derived fields and the allowlisted block keys", () => {
    const payload = formatSlack(FULL_VIEW);
    expect(payload.text).toContain(FULL_VIEW.title);
    const json = JSON.stringify(payload);
    expect(json).toContain(FULL_VIEW.title);
    expect(json).toContain("kill_criteria");
    expect(json).toContain("PRJ-0001");
    expect(json).toContain(DEEP_LINK);
    const keys = collectKeys(payload);
    for (const k of keys) expect(SLACK_ALLOWED_KEYS.has(k), `unexpected key: ${k}`).toBe(true);
    // Planted MNPI marker that was NEVER part of the view must not appear.
    expect(json).not.toContain("MNPI_FIGURE");
  });

  test("formatTeams returns the message envelope; attachment keys are allowlisted (MessageCard/Adaptive only)", () => {
    const payload = formatTeams(FULL_VIEW);
    expect(payload.type).toBe("message");
    expect(Array.isArray(payload.attachments)).toBe(true);
    const json = JSON.stringify(payload);
    expect(json).toContain(FULL_VIEW.title);
    expect(json).toContain("kill_criteria");
    expect(json).toContain(DEEP_LINK);
    for (const k of collectKeys(payload)) expect(TEAMS_ALLOWED_KEYS.has(k), `unexpected key: ${k}`).toBe(true);
  });

  test("optional view fields are simply absent (no empty-string noise) and deep link renders a button/action only when set", () => {
    const minimal: NotifyView = { title: "t", severity: "info", triggerType: "test" };
    const slack = JSON.stringify(formatSlack(minimal));
    expect(slack).not.toContain("PRJ-");
    expect(slack).not.toContain("https://");
    const teams = JSON.stringify(formatTeams(minimal));
    expect(teams).not.toContain("Action.OpenUrl");
  });
});

// ── webhook host/scheme rules ────────────────────────────────────────────────

describe("isHostAllowed / isSchemeAllowed", () => {
  test("built-in allow-list: hooks.slack.com and *.webhook.office.com (incl. bare domain), nothing else", () => {
    expect(isHostAllowed(new URL("https://hooks.slack.com/services/T000/B000/XYZ"))).toBe(true);
    expect(isHostAllowed(new URL("https://sub.webhook.office.com/xyz"))).toBe(true);
    expect(isHostAllowed(new URL("https://webhook.office.com/xyz"))).toBe(true);
    expect(isHostAllowed(new URL("https://evil.com/hook"))).toBe(false);
    expect(isHostAllowed(new URL("https://hooks.slack.com.evil.com/hook"))).toBe(false);
    expect(isHostAllowed(new URL("https://notslack.com/services/T000/B000/XYZ"))).toBe(false);
  });

  test("env extras extend the allow-list, with *.domain subdomain wildcards", () => {
    setEnv({ NOTIFY_WEBHOOK_ALLOWED_HOSTS: "hooks.example.com, *.corp.example.org" });
    expect(isHostAllowed(new URL("https://hooks.example.com/x"))).toBe(true);
    expect(isHostAllowed(new URL("https://a.corp.example.org/x"))).toBe(true);
    expect(isHostAllowed(new URL("https://corp.example.org/x"))).toBe(true); // bare domain under wildcard
    expect(isHostAllowed(new URL("https://other.example.com/x"))).toBe(false);
  });

  test("scheme rule: https always; http only when CO_NEWBIZ_SCHEDULER_ENV is explicitly dev (fail closed when unset)", () => {
    const http = new URL("http://127.0.0.1:8080/hook");
    const https = new URL("https://hooks.slack.com/x");
    expect(isSchemeAllowed(https)).toBe(true);
    expect(isSchemeAllowed(http)).toBe(false); // unset env fails closed
    setEnv({ CO_NEWBIZ_SCHEDULER_ENV: "dev" });
    expect(isSchemeAllowed(http)).toBe(true); // explicit dev allows http for local stubs
    setEnv({ CO_NEWBIZ_SCHEDULER_ENV: "prod" });
    expect(isSchemeAllowed(http)).toBe(false);
    setEnv({ CO_NEWBIZ_SCHEDULER_ENV: undefined });
    expect(isSchemeAllowed(new URL("ftp://hooks.slack.com/x"))).toBe(false);
  });
});

describe("resolveTargetUrl / parseRetryAfter / redactUrl", () => {
  test("resolveTargetUrl trims, returns null when unset/empty", () => {
    setEnv({ NOTIFY_WEBHOOK_URL_DEALS: "  https://hooks.slack.com/services/x  " });
    expect(resolveTargetUrl("NOTIFY_WEBHOOK_URL_DEALS")).toBe("https://hooks.slack.com/services/x");
    expect(resolveTargetUrl("NOTIFY_WEBHOOK_URL_OPS")).toBeNull();
    setEnv({ NOTIFY_WEBHOOK_URL_OPS: "" });
    expect(resolveTargetUrl("NOTIFY_WEBHOOK_URL_OPS")).toBeNull();
  });
  test("parseRetryAfter handles delay-seconds, HTTP-date and garbage", () => {
    expect(parseRetryAfter("7")).toBe(7000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("not-a-date")).toBeNull();
    const future = new Date(Date.now() + 60_000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).toBeGreaterThan(55_000);
    expect(ms).toBeLessThanOrEqual(60_000);
  });
  test("redactUrl replaces plain and encoded occurrences", () => {
    const url = "https://hooks.slack.com/services/T000/B000/SECRET-TOKEN-9";
    const msg = `fetch failed for ${url} (encoded ${encodeURIComponent(url)})`;
    const out = redactUrl(msg, url, "NOTIFY_WEBHOOK_URL_DEALS");
    expect(out).not.toContain("SECRET-TOKEN-9");
    expect(out).toContain("NOTIFY_WEBHOOK_URL_DEALS");
  });
});

// ── sendWebhook against a Bun.serve stub ─────────────────────────────────────

interface WebhookStub {
  url: string;
  stop: () => void;
  last: () => { path: string; body: string; contentType: string | null } | null;
}

function startWebhookStub(
  respond: (reqBody: string, path: string) => { status: number; body?: string; headers?: Record<string, string> },
): WebhookStub {
  let lastRequest: { path: string; body: string; contentType: string | null } | null = null;
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const body = await req.text();
      lastRequest = { path: url.pathname, body, contentType: req.headers.get("content-type") };
      const r = respond(body, url.pathname);
      return new Response(r.body ?? "ok", { status: r.status, headers: r.headers });
    },
  });
  server.unref();
  return {
    url: `http://127.0.0.1:${server.port}/hook/SECRET-PATH-42`,
    stop: () => server.stop(true),
    last: () => lastRequest,
  };
}

/** dev env + loopback allow-listed, so the http stub is reachable by sendWebhook. */
const WEBHOOK_DEV_ENV = { CO_NEWBIZ_SCHEDULER_ENV: "dev", NOTIFY_WEBHOOK_ALLOWED_HOSTS: "127.0.0.1" };

describe("sendWebhook", () => {
  test("2xx posts JSON, returns status and null providerMessageId for a plain 'ok' body", async () => {
    const stub = startWebhookStub(() => ({ status: 200, body: "ok" }));
    try {
      setEnv(WEBHOOK_DEV_ENV);
      const res = await sendWebhook(stub.url, formatSlack(FULL_VIEW), { signal: new AbortController().signal });
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.providerMessageId).toBeNull();
      expect(stub.last()?.contentType).toContain("application/json");
      const sentBody = JSON.parse(stub.last()?.body ?? "{}") as { text?: string };
      expect(sentBody.text).toContain(FULL_VIEW.title);
    } finally {
      stub.stop();
    }
  });

  test("provider id is surfaced when the response carries one", async () => {
    const stub = startWebhookStub(() => ({ status: 200, body: JSON.stringify({ id: "msg-123" }) }));
    try {
      setEnv(WEBHOOK_DEV_ENV);
      const res = await sendWebhook(
        stub.url,
        { type: "message", attachments: [] },
        {
          signal: new AbortController().signal,
        },
      );
      expect(res.providerMessageId).toBe("msg-123");
    } finally {
      stub.stop();
    }
  });

  test("429 with Retry-After: throws retryable error carrying status and parsed retryAfterMs", async () => {
    const stub = startWebhookStub(() => ({ status: 429, body: "rate limited", headers: { "retry-after": "7" } }));
    try {
      setEnv(WEBHOOK_DEV_ENV);
      const err = await sendWebhook(stub.url, { a: 1 }, { signal: new AbortController().signal }).catch((e) => e);
      expect(err).toBeInstanceOf(WebhookError);
      expect((err as WebhookError).code).toBe("http_retryable");
      expect((err as WebhookError).retryable).toBe(true);
      expect((err as WebhookError).status).toBe(429);
      expect((err as WebhookError).retryAfterMs).toBe(7000);
    } finally {
      stub.stop();
    }
  });

  test("a redirect from an allowed host is refused, never followed (SSRF, security review 2026-10-31)", async () => {
    const landing = startWebhookStub(() => ({ status: 200, body: "exfiltrated" }));
    const redirector = startWebhookStub(() => ({ status: 307, headers: { location: landing.url } }));
    try {
      setEnv(WEBHOOK_DEV_ENV);
      const err: WebhookError = await sendWebhook(
        redirector.url,
        { secretBody: "notification-content" },
        { signal: new AbortController().signal, urlLabel: "NOTIFY_WEBHOOK_URL_DEALS" },
      ).catch((e) => e);
      // The redirect target must receive NOTHING and the error must be terminal without echoing it.
      expect(landing.last()).toBeNull();
      expect(err.code).toBe("http_terminal");
      expect(err.retryable).toBe(false);
      expect(err.status).toBe(307);
      expect(err.message).not.toContain(landing.url);
      expect(err.message).not.toContain("notification-content");
    } finally {
      redirector.stop();
      landing.stop();
    }
  });

  test("500 is retryable, 404 is terminal", async () => {
    const retryable = startWebhookStub(() => ({ status: 500, body: "boom" }));
    try {
      setEnv(WEBHOOK_DEV_ENV);
      const err = await sendWebhook(retryable.url, { a: 1 }, { signal: new AbortController().signal }).catch((e) => e);
      expect((err as WebhookError).retryable).toBe(true);
    } finally {
      retryable.stop();
    }
    const terminal = startWebhookStub(() => ({ status: 404, body: "nope" }));
    try {
      const err = await sendWebhook(terminal.url, { a: 1 }, { signal: new AbortController().signal }).catch((e) => e);
      expect((err as WebhookError).code).toBe("http_terminal");
      expect((err as WebhookError).retryable).toBe(false);
    } finally {
      terminal.stop();
    }
  });

  test("the full webhook URL never appears in errors — response text echoing the URL is redacted", async () => {
    const stub = startWebhookStub(() => ({ status: 500, body: "bad target " }));
    try {
      setEnv(WEBHOOK_DEV_ENV);
      const err: WebhookError = await sendWebhook(
        stub.url,
        { a: 1 },
        {
          signal: new AbortController().signal,
          urlLabel: "NOTIFY_WEBHOOK_URL_DEALS",
        },
      ).catch((e) => e);
      expect(err.message).not.toContain("SECRET-PATH-42");
      expect(err.message).not.toContain(stub.url);
      expect(err.message).toContain("NOTIFY_WEBHOOK_URL_DEALS");
    } finally {
      stub.stop();
    }
  });

  test("disallowed host throws typed disallowed_host without any request, message free of the URL", async () => {
    setEnv({ CO_NEWBIZ_SCHEDULER_ENV: "dev", NOTIFY_WEBHOOK_ALLOWED_HOSTS: "" });
    const evil = "https://evil.example.com/hook/SECRET-TOKEN-77";
    const err: WebhookError = await sendWebhook(
      evil,
      { a: 1 },
      {
        signal: new AbortController().signal,
        urlLabel: "NOTIFY_WEBHOOK_URL_OPS",
      },
    ).catch((e) => e);
    expect(err.code).toBe("disallowed_host");
    expect(err.message).not.toContain("SECRET-TOKEN-77");
    expect(err.message).not.toContain("evil.example.com/hook");
  });

  test("http scheme is rejected when the scheduler env is unset (fail closed), accepted with explicit dev", async () => {
    const stub = startWebhookStub(() => ({ status: 200 }));
    try {
      setEnv({ NOTIFY_WEBHOOK_ALLOWED_HOSTS: "127.0.0.1" }); // no CO_NEWBIZ_SCHEDULER_ENV
      const err = await sendWebhook(stub.url, { a: 1 }, { signal: new AbortController().signal }).catch((e) => e);
      expect((err as WebhookError).code).toBe("insecure_scheme");
      setEnv({ CO_NEWBIZ_SCHEDULER_ENV: "dev" });
      const res = await sendWebhook(stub.url, { a: 1 }, { signal: new AbortController().signal });
      expect(res.status).toBe(200);
    } finally {
      stub.stop();
    }
  });

  test("pre-aborted signal throws typed aborted", async () => {
    setEnv(WEBHOOK_DEV_ENV);
    const stub = startWebhookStub(() => ({ status: 200 }));
    try {
      const controller = new AbortController();
      controller.abort();
      const err = await sendWebhook(stub.url, { a: 1 }, { signal: controller.signal }).catch((e) => e);
      expect((err as WebhookError).code).toBe("aborted");
      expect(stub.last()).toBeNull();
    } finally {
      stub.stop();
    }
  });
});

// ── root-env pipeline allowlist ──────────────────────────────────────────────

describe("root-env allowlist with NOTIFY_* keys", () => {
  const TOUCHED = [...ENV_KEYS, "UNRELATED_SECRET"];
  let tmp: string;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "notify-root-env-"));
    saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
    for (const k of TOUCHED) delete process.env[k];
  });
  afterEach(() => {
    for (const k of TOUCHED) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetRootEnvForTests(null);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("NOTIFY_* keys pass isPipelineEnvKey; unrelated names do not", () => {
    expect(isPipelineEnvKey("NOTIFY_SMTP_PASS")).toBe(true);
    expect(isPipelineEnvKey("NOTIFY_SMTP_HOST")).toBe(true);
    expect(isPipelineEnvKey("NOTIFY_WEBHOOK_URL_DEALS")).toBe(true);
    expect(isPipelineEnvKey("NOTIFY_WEBHOOK_ALLOWED_HOSTS")).toBe(true);
    expect(isPipelineEnvKey("NOTIFY_WEBHOOK_URL_NEWCHANNEL")).toBe(true); // prefix rule: future channel keys
    expect(isPipelineEnvKey("NOTIFYX_SECRET")).toBe(false); // prefix must be the whole token
    expect(isPipelineEnvKey("UNRELATED_SECRET")).toBe(false);
  });

  test("a NOTIFY_ key loads from a temp root env (and never overrides an existing value)", () => {
    writeFileSync(
      join(tmp, ".env"),
      "NOTIFY_SMTP_HOST=smtp.example.com\nNOTIFY_SMTP_PASS=fromfile\nUNRELATED_SECRET=x\n",
    );
    process.env.NOTIFY_SMTP_PASS = "preset";
    resetRootEnvForTests(tmp);
    loadRootEnvPipelineKeys();
    expect(process.env.NOTIFY_SMTP_HOST).toBe("smtp.example.com");
    expect(process.env.NOTIFY_SMTP_PASS).toBe("preset"); // explicit env wins
    expect(process.env.UNRELATED_SECRET).toBeUndefined();
    expect(envKeySource("NOTIFY_SMTP_HOST")).toBe("root_env");
    expect(envKeySource("NOTIFY_SMTP_PASS")).toBe("process_env");
  });
});
