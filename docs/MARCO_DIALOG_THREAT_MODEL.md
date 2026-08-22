# Marco OS autonomous-dialog threat model

Status: non-production design for PR #13. No production activation is authorized by this document.

## Protected assets

- Vault Verified production database and service-role credentials
- consultant/customer/auth/grading/payment data
- Stripe and other commerce secrets
- Notion workspace content outside the AI Handoff Queue
- OpenAI/Anthropic API credentials and spend limits
- integrity of the AI Handoff Queue audit trail

## Trust boundaries

1. **Notion** owns governed handoff content and human-readable lifecycle/audit state.
2. **Vercel preview function** is the primary event-driven executor.
3. **Dedicated Marco OS Supabase runtime** owns only lease/idempotency/recovery state.
4. **Model providers** receive only the governed handoff payload needed for one turn.
5. **Vault Verified production** is outside the dialog runtime trust boundary.

## Non-negotiable controls

- Never place Vault production DB/service-role credentials in the dialog runtime.
- Never allow dialog code to query arbitrary Vault tables or execute arbitrary SQL.
- Use a dedicated Notion integration shared only to the AI Handoff Queue when feasible.
- Verify Notion webhook HMAC before reading or mutating a handoff.
- Validate `Status`, `To`, `Authorization`, `Scope`, `Requires Human Approval`, `Turn Count`, and `Max Turns` before acquiring a lease.
- Acquire a single atomic Supabase lease before any provider call.
- Re-fetch the Notion page after claiming and before provider execution; ownership must still match.
- Never overwrite a non-empty `Reply`.
- Provider timeout/error/empty output => `INTERRUPTED`; never fabricate `REPLIED`.
- Secrets live only in Vercel/Supabase secret stores and must not be logged.
- Logs contain IDs/status/error classes, not full prompts, replies, tokens, or secrets.
- Start with synthetic/non-sensitive handoffs only.
- Vercel spend cap/alerts and application-level circuit breaker are required before activation.

## Threats and mitigations

### Duplicate/replayed webhooks
**Threat:** Notion retries or an attacker replays a valid event, causing duplicate provider calls.

**Mitigation:** Supabase `acquire_turn_lease()` is atomic by `handoff_id`; a second worker cannot acquire an unexpired or terminal lease. A completed handoff is never re-opened automatically.

### Two hosts race (Vercel + Supabase recovery)
**Threat:** primary and failover invoke the provider simultaneously.

**Mitigation:** both hosts must use the same lease RPC and unique lease token. Only the lease owner may complete the turn.

### Stale worker
**Threat:** a worker resumes after its lease expired and writes over a newer worker.

**Mitigation:** terminal lease update requires exact `handoff_id + owner + lease_token`; Notion reply update also re-checks ownership and empty Reply immediately before write.

### Prompt injection / scope escape
**Threat:** Message text asks the model to access GitHub, Supabase, payments, secrets, or production systems.

**Mitigation:** MVP provider execution has no such tools or credentials. Unsupported scope fails closed before provider invocation. Prompt states that external visibility is unavailable.

### Queue-page spoofing
**Threat:** a valid Notion webhook references a page outside the handoff queue.

**Mitigation:** dispatcher fetches the page and verifies its parent data-source ID equals the configured AI Handoff Queue ID.

### Webhook forgery
**Threat:** public Vercel endpoint is invoked directly.

**Mitigation:** reject missing/invalid Notion HMAC with constant-time comparison. No provider or Notion mutation occurs first. Preview access should use a narrow automation bypass rather than disabling deployment protection globally.

### Secret leakage
**Threat:** keys appear in repo, Notion, provider prompt, or logs.

**Mitigation:** environment variables only; redact errors; never include secret values in responses/logging; secret scan before merge.

### Runaway dialogue / cost
**Threat:** ping-pong or malformed events consume provider/hosting budget.

**Mitigation:** Max Turns, Max Runtime Seconds, atomic daily/monthly provider-call counters, hard circuit-breaker threshold, Vercel spend cap/alerts, Supabase usage alerts, and no automatic continuation when human approval is required.

### Production-data exposure
**Threat:** dialog worker gets broad Marco OS/Vault credentials.

**Mitigation:** dedicated least-privilege service identities. The dialog runtime has only Notion queue credentials, model API keys, and isolated lease-store credentials. The isolated Supabase `service_role` gets execute rights only on the three dialog RPCs; anon/authenticated get no dialog-schema access.

## Smoke-test gates before activation

1. Valid synthetic OpenAI turn: exactly one provider call and one reply.
2. Duplicate webhook delivery: no second provider call.
3. Concurrent Vercel/failover acquisition: exactly one lease winner.
4. Invalid signature: HTTP 401/403 and zero downstream calls.
5. Unsupported scope / human approval / Max Turns: fail closed, zero provider calls.
6. Existing non-empty Reply: zero overwrite.
7. Forced provider timeout: `INTERRUPTED`, no fabricated reply.
8. Expired lease recovery: one recovery worker, stale worker cannot complete afterward.
9. Prompt requesting production secrets/data: model cannot access them and states missing visibility.
10. Secret scan and log review show no credentials or sensitive payloads.
11. Circuit-breaker threshold blocks further provider calls.

Only after these gates produce evidence should production activation be considered separately.
