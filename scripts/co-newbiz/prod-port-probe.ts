#!/usr/bin/env bun
// @version 1.0.0
//
// prod-port-probe - host-side production port-publish invariant probe (design addendum
// 2026-11-28: docs/designs/2026-09-21-docker-prod-cicd-design.md, REQ-P8..P11). Detects the
// 2026-11-28 incident class that the compose healthcheck structurally cannot see: Docker
// Desktop (macOS) loses the host port-forward while the container itself keeps running and
// serving /api/health INSIDE - `NetworkSettings.Ports["7749/tcp"]` is empty, nothing listens
// on host 127.0.0.1:7749, and the Cloudflare tunnel is dark.
//
// Two checks, invariant first (dev-tick model: a short-lived HOST process - the HTTP check
// must originate on the host to exercise the publish):
//   1. Publish invariant  - `docker inspect co-newbiz-web`: on a RUNNING container,
//      NetworkSettings.Ports["7749/tcp"] must be a non-empty array. Empty/absent on a
//      running container = PUBLISH_DEAD, checked BEFORE HTTP so the operator gets the
//      specific diagnosis. HostConfig.PortBindings is captured as diagnostic only:
//      desired binding present = Docker backend desync (fix: force-recreate); absent =
//      compose/config drift. A container that is missing or not running is DEGRADED
//      (docker_down), never PUBLISH_DEAD.
//   2. HTTP               - GET http://127.0.0.1:7749/api/health (override with
//      CO_NEWBIZ_HEALTH_URL, the same constant scripts/deploy-web.ts gates on) must be 200.
//
// Outcomes: OK exit 0; DEGRADED exit 1 (sub_reason app_down | docker_down; malformed
// inspect output is docker_down, never silently OK); PUBLISH_DEAD exit 2 (even when HTTP
// also fails - the invariant takes precedence). Exactly one JSON line per run goes to
// stdout (grep-shaped for the scheduler out-log patterns). On any non-OK outcome the probe
// appends the same line to ~/Library/Logs/co-newbiz/prod-port-probe.log (the directory
// scheduler-install.ts owns: mode 0700 dir, 0600 files) and fires a macOS user
// notification - the only channel that works when the app, the tunnel and the container
// are all unavailable. Strictly read-only otherwise: one docker inspect, one HTTP GET,
// zero DB writes, zero secrets (REQ-P10/P11). Scheduled by launchd via
// `scheduler-install.ts --job port-probe` (StartInterval 300, RunAtLoad true) - never an
// in-process timer (ADR-0019/ADR-0189). It never self-heals: recovery is documented in
// docs/runbooks/deployment.md section 8.
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONTAINER = "co-newbiz-web";
const PORT_KEY = "7749/tcp";
const HEALTH_URL = process.env.CO_NEWBIZ_HEALTH_URL ?? "http://127.0.0.1:7749/api/health";
const HTTP_TIMEOUT_MS = 3000;
const DOCKER = Bun.which("docker") ?? "docker";

export type Outcome = "OK" | "DEGRADED" | "PUBLISH_DEAD";
export type SubReason = "app_down" | "docker_down" | null;
export type PublishBinding = "present" | "absent" | "unknown";
export type HttpStatus = "ok" | "fail";

export interface InspectFacts {
  /** docker .State.Running - a missing/not-running container is DEGRADED, never PUBLISH_DEAD. */
  running: boolean;
  /** .NetworkSettings.Ports["7749/tcp"] is a non-empty array (the invariant, active mapping only). */
  portPublished: boolean;
  /** .HostConfig.PortBindings has a non-empty 7749/tcp entry (diagnostic only, not part of the invariant). */
  desiredBinding: boolean;
}

export interface Classification {
  outcome: Outcome;
  sub_reason: SubReason;
}

export interface ReportLine {
  ts: string;
  outcome: Outcome;
  sub_reason: SubReason;
  /** Diagnostic: is the DESIRED binding (HostConfig.PortBindings) present? Present + unpublished = backend desync. */
  publish_binding: PublishBinding;
  http: HttpStatus;
  detail: string;
}

export const EXIT_CODES: Record<Outcome, number> = { OK: 0, DEGRADED: 1, PUBLISH_DEAD: 2 };

export function exitCodeFor(outcome: Outcome): number {
  return EXIT_CODES[outcome];
}

/** Alert log the probe appends to on any non-OK outcome (design: the scheduler-install log dir, no new location). */
export function alertLogPath(home: string = homedir()): string {
  return join(home, "Library", "Logs", "co-newbiz", "prod-port-probe.log");
}

/**
 * Parse the stdout of `docker inspect <container>` (a JSON array with one object) into the
 * facts the classification needs. Any malformed shape - invalid JSON, not an array, an
 * empty array, a missing .State - returns null, which classifies as DEGRADED (docker_down),
 * never silently as OK. An absent Ports/PortBindings key counts as unpublished/unbound.
 */
export function parseInspect(stdout: string): InspectFacts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const entry = parsed[0] as Record<string, unknown> | null;
  if (!entry || typeof entry !== "object") return null;
  const state = entry.State as Record<string, unknown> | undefined;
  if (!state || typeof state !== "object") return null;
  const ports = (entry.NetworkSettings as Record<string, unknown> | undefined)?.Ports as
    | Record<string, unknown>
    | undefined;
  const bindings = (entry.HostConfig as Record<string, unknown> | undefined)?.PortBindings as
    | Record<string, unknown>
    | undefined;
  return {
    running: state.Running === true,
    portPublished: isNonEmptyBinding(ports),
    desiredBinding: isNonEmptyBinding(bindings),
  };
}

function isNonEmptyBinding(mapping: Record<string, unknown> | undefined): boolean {
  const binding = mapping?.[PORT_KEY];
  return Array.isArray(binding) && binding.length > 0;
}

/**
 * The classification matrix (pure; no Docker daemon, no network). Invariant first, then HTTP:
 *   inspect null (failed/malformed)          -> DEGRADED docker_down
 *   container not running                    -> DEGRADED docker_down (NOT PUBLISH_DEAD)
 *   running + port unpublished               -> PUBLISH_DEAD (regardless of HTTP)
 *   running + published + HTTP ok            -> OK
 *   running + published + HTTP fail          -> DEGRADED app_down
 */
export function classifyOutcome(inspect: InspectFacts | null, httpOk: boolean): Classification {
  if (!inspect?.running) return { outcome: "DEGRADED", sub_reason: "docker_down" };
  if (!inspect.portPublished) return { outcome: "PUBLISH_DEAD", sub_reason: null };
  if (httpOk) return { outcome: "OK", sub_reason: null };
  return { outcome: "DEGRADED", sub_reason: "app_down" };
}

/** The one JSON line per run (stdout, and the alert log on non-OK - same shape). */
export function buildReportLine(
  classification: Classification,
  inspect: InspectFacts | null,
  http: HttpStatus,
  now: Date = new Date(),
): ReportLine {
  const publish_binding: PublishBinding = inspect === null ? "unknown" : inspect.desiredBinding ? "present" : "absent";
  const detail = detailFor(classification, inspect, http);
  return {
    ts: now.toISOString(),
    outcome: classification.outcome,
    sub_reason: classification.sub_reason,
    publish_binding,
    http,
    detail,
  };
}

function detailFor(classification: Classification, inspect: InspectFacts | null, http: HttpStatus): string {
  const httpPart = http === "ok" ? "/api/health 200" : "/api/health failed";
  if (classification.outcome === "OK") return `host ${portOfKey()} published, ${httpPart}`;
  if (classification.outcome === "PUBLISH_DEAD") {
    const cause =
      inspect === null
        ? "unexpected state"
        : inspect.desiredBinding
          ? "desired binding present - Docker backend desync; fix: docker compose up -d --force-recreate web"
          : "no desired binding - compose/config drift";
    return `container running but host ${portOfKey()} unpublished (${cause})`;
  }
  if (classification.sub_reason === "docker_down") {
    return inspect === null
      ? `docker inspect ${CONTAINER} failed or returned malformed output`
      : `container ${CONTAINER} is missing or not running`;
  }
  return `host ${portOfKey()} published but ${httpPart}`;
}

function portOfKey(): string {
  return PORT_KEY.replace("/tcp", "");
}

// ── Alerting (non-OK only) ─────────────────────────────────────────────────

function appendAlertLog(line: ReportLine): void {
  try {
    const file = alertLogPath();
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    if (!existsSync(file)) closeSync(openSync(file, "a", 0o600));
    chmodSync(file, 0o600);
    appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
  } catch (e) {
    console.error(`prod-port-probe: failed to append alert log: ${(e as Error).message}`);
  }
}

/** Escape a string for an AppleScript double-quoted literal. */
function applescriptEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * macOS user notification - best-effort by design (REQ-P10): the LaunchAgent runs in the
 * user session, and on a non-macOS host or when osascript is missing/fails this silently
 * degrades to the persistent log line only.
 */
function notify(line: ReportLine): void {
  if (process.platform !== "darwin" || !Bun.which("osascript")) return;
  const subtitle =
    line.outcome === "PUBLISH_DEAD"
      ? "PUBLISH_DEAD: host 7749 unpublished"
      : `DEGRADED (${line.sub_reason ?? "unknown"})`;
  const script = `display notification "${applescriptEscape(line.detail)}" with title "co-newbiz prod" subtitle "${applescriptEscape(subtitle)}"`;
  try {
    Bun.spawnSync(["osascript", "-e", script]);
  } catch {
    // notification is best-effort; the log line is the durable record
  }
}

// ── Checks ─────────────────────────────────────────────────────────────────

function inspectContainer(): { facts: InspectFacts | null; exitCode: number } {
  const p = Bun.spawnSync([DOCKER, "inspect", CONTAINER], { stdout: "pipe", stderr: "pipe" });
  if ((p.exitCode ?? 1) !== 0) return { facts: null, exitCode: p.exitCode ?? 1 };
  return { facts: parseInspect(p.stdout.toString()), exitCode: 0 };
}

async function httpHealthy(): Promise<HttpStatus> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    return res.ok ? "ok" : "fail";
  } catch {
    return "fail";
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const { facts } = inspectContainer();
  const http = await httpHealthy();
  const classification = classifyOutcome(facts, http === "ok");
  const line = buildReportLine(classification, facts, http);
  console.log(JSON.stringify(line)); // exactly one JSON line per run
  if (classification.outcome !== "OK") {
    appendAlertLog(line);
    notify(line);
  }
  process.exit(exitCodeFor(classification.outcome));
}
