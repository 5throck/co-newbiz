# ADR-0190: Notification delivery — email and webhook transport, delivery ledger, recipient policy

**Status**: Proposed
**Date**: 2026-10-29
**Deciders**: PM (approval); proposed by platform-lead; reviewers security-engineer, data-architect, sre, backend-engineer
**Related**: ADR-0017 (bidirectional notifications), ADR-0189 (scheduler model, sibling), ADR-0012 (append-only audit), ADR-0014 (reversible migrations)
**Design of record**: `docs/designs/2026-10-29-scheduled-jobs-design.md` §13

## Context

The `notification` table records channel (`in_app|email|webhook|all`) and bundle (`immediate|daily`), but no transport exists (`db/lib/watch-engine.ts` defers it to "Wave 5.6/5.9"), so email and webhook notifications are never sent and nothing records delivery. `notification.project_id` is `NOT NULL`, which prevents system notifications such as scheduler failures. The owner decided on 2026-10-29 to deliver in-app plus email and webhook.

## Decision

1. **Transport**: SMTP email and Slack/Teams-compatible webhooks. All credentials and webhook URLs come from env (root-env loader). Admin config stores only channel keys and env-var names. Webhook hosts are allow-listed and HTTPS is mandatory in prod.
2. **Delivery runs only in scheduler jobs** (ADR-0189): `notify.deliver` runs every tick for immediate rows, and `notify.digest` runs daily for bundled rows. The web server never sends. An admin test send only enqueues.
3. **Delivery ledger**: a new `notification_delivery` table holds one row per notification × recipient × channel, with status, attempts, next attempt, a scrubbed error, a masked recipient, a digest id and an `is_test` flag. Uniqueness on (notification, recipient, channel, target) makes expansion idempotent.
4. **Recipient policy**: new tables `notification_recipient_policy` (severity/trigger → audience → channels and bundle) and `user_notification_pref` (per-user opt-out). In-app delivery and `urgent` kill-criteria alerts cannot be opted out of.
5. **Schema changes to `notification`**: `project_id` becomes nullable, and `title` and `source_ref` are added. `'test'` is added to the `trigger_type` CHECK set. The migration is a reversible rebuild (ADR-0014).
6. **Content restriction**: email and webhook bodies carry only title, severity, trigger, project identity and a deep link. They never carry figures or document content (MNPI). The full payload stays in-app behind project permissions.
7. **Retry, dedupe, rate limits**:
   - Retries back off at 1/5/15/60 min, then the delivery fails terminally.
   - Permanent errors are not retried.
   - A `dedupe_key` plus the rule's cooldown suppresses duplicate deliveries.
   - Token-bucket limits apply per target and per user. Excess deliveries are deferred to the digest, never dropped.

## Consequences

- Watch alerts and scheduler failures reach people outside the app, which is a new outbound data path, so a security-engineer review is mandatory before merge.
- Delivery state becomes auditable per channel. The admin history UI and SRE watch rules read `notification_delivery`.
- Admins see addresses and URLs only masked, so the full values exist only in env and user records.
- Delivery depends on the scheduler heartbeat. If the tick stops, external notifications stop, and only in-app rows remain.

## Alternatives considered

- **Send synchronously from producers or the web server**: rejected. It couples request latency and failures to SMTP and webhook availability, and it contradicts ADR-0019/0189.
- **Store webhook URLs in the DB**: rejected. The URLs are bearer secrets.
- **A third-party notification SaaS**: deferred. It adds a processor of deal metadata that would need its own privacy review.
