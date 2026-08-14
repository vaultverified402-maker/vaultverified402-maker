# Marco OS Near-Immediate AI Dialogue Dispatcher

## Goal

Remove Marco from the manual `check` loop while keeping the Notion AI Handoff Queue as the authoritative communication and audit ledger.

Target boundary:

- **Marco OS** — orchestration and governance
- **Notion AI Handoff Queue** — communication and durable audit trail
- **Vercel** — primary event-driven executor
- **Dedicated Marco OS Supabase runtime** — lease/idempotency/recovery/cost-counter state only
- **OpenAI / Claude** — reasoning workers
- **Vault Verified production** — outside the dialog trust boundary

This draft remains non-production. It does not authorize merge, production activation, or use of Vault production credentials.

## Primary runtime

The Vercel function lives at:

`api/marco-ai-dialogue-dispatcher.js`

Notion `page.created` / `page.properties_updated` webhooks wake the function. The function verifies the webhook HMAC, fetches the changed page, proves it belongs to the AI Handoff Queue, validates governance fields, acquires an atomic Supabase lease, then invokes exactly one model provider.

No Termux process or short-interval primary poll loop is required.

## Isolated execution state

The lease/circuit-breaker migration lives at:

`supabase/migrations/20260814_marco_dialog_runtime.sql`

It is **design-only** until a dedicated Marco OS Supabase runtime is selected. It must never be applied to the live Vault Verified Supabase project merely to enable dialogue.

The isolated runtime owns only:

- handoff lease token / owner / expiry
- attempt count
- terminal execution state
- provider request metadata
- daily/monthly provider-call counters

It does not contain Vault records, grading, auth, consultant, customer, Stripe, or production data.

The dedicated Supabase project must expose the `marco_dialog` schema through PostgREST so Vercel can call its three RPCs. `anon` and `authenticated` have no schema/table/function access. `service_role` receives only schema usage plus execute permission on `acquire_turn_lease`, `complete_turn_lease`, and `reserve_budget`; the Vercel secret store holds that dedicated runtime key.

## Trust boundary

The dialog worker may update only handoff lifecycle fields required by the protocol: `Status`, `Claimed By`, `Claimed At`, `Reply`, `Model`, `Turn Count`, `Attempt Count`, plus creation of the next governed queue item when a model explicitly requests continuation.

MVP autonomous execution supports only `Scope = Notion only`. Provider API calls receive no GitHub, Vercel, Supabase-production, Gmail, filesystem, Stripe, or Vault tools/credentials.

The dispatcher fails closed when:

- webhook signature is invalid
- page is outside the configured queue
- `Requires Human Approval = true`
- `Authorization` is unsupported
- scope contains anything beyond `Notion only`
- `Turn Count >= Max Turns`
- a claim/reply already exists
- atomic lease cannot be acquired
- circuit breaker is reached
- provider credentials are missing
- provider times out/errors/returns empty output
- final ownership check fails

Provider failure produces `INTERRUPTED`, never a fabricated `REPLIED`.

## Exactly-one-turn discipline

Both the Vercel primary and future Supabase recovery worker must use the same `acquire_turn_lease()` RPC. A second worker cannot acquire an unexpired or terminal handoff lease.

After the Notion claim, the Vercel worker re-reads the page and proceeds only when `Status = IN_PROGRESS`, `Claimed By` exactly matches its unique claim label, and `Reply` is still empty. It repeats that ownership check immediately before the final write.

A stale worker cannot complete a newer worker's lease because terminal completion requires the exact lease token.

## Conversation continuation

Each provider response must begin with either:

- `CONTINUE:` when another model turn is genuinely needed
- `DONE:` when the task is complete

The marker is stripped before writing `Reply`. `CONTINUE:` creates a new governed queue item addressed to the other model, preserving Task, Authorization, Scope, Requires Human Approval, Max Turns, and Max Runtime Seconds. Max Turns remains a hard stop.

## Required Vercel configuration

Secrets/configuration are environment variables only:

```text
NOTION_API_KEY
NOTION_HANDOFF_DATA_SOURCE_ID
NOTION_WEBHOOK_VERIFICATION_TOKEN
SUPABASE_DIALOG_URL
SUPABASE_DIALOG_SERVICE_KEY
SUPABASE_DIALOG_SCHEMA=marco_dialog
OPENAI_API_KEY
OPENAI_MODEL
ANTHROPIC_API_KEY
ANTHROPIC_MODEL
DIALOG_DAILY_PROVIDER_CALL_LIMIT
DIALOG_MONTHLY_PROVIDER_CALL_LIMIT
```

No live key belongs in GitHub, Notion messages, provider prompts, or logs.

The Notion integration should be shared only to the AI Handoff Queue where feasible.

## Cost protection

Cost protection is layered:

1. Atomic daily/monthly call counters in the isolated Supabase runtime.
2. Conservative application hard limits; the worker pauses before provider invocation once reached.
3. Vercel Pro spend cap/alerts configured before activation.
4. Supabase usage/billing alerts configured where available.
5. Five-minute passive recovery cadence rather than high-frequency polling.
6. `Max Turns` and `Max Runtime Seconds` constrain each dialogue.

## Preview state

PR #13 builds automatically as a Vercel preview and must remain `target = null` / non-production until separately approved.

Current preview protection uses Vercel authentication. That is good for review, but Notion cannot deliver a normal webhook through an SSO wall. Before a synthetic webhook smoke test, configure a **narrow webhook-access mechanism** for the preview (for example a deployment protection bypass intended for automation) rather than making the whole preview broadly public. Signature verification remains mandatory at the function itself.

## Smoke-test gates

Before any production approval:

1. Valid synthetic turn => exactly one provider call and one reply.
2. Duplicate webhook => no duplicate provider call.
3. Vercel primary + recovery race => exactly one lease winner.
4. Invalid signature => zero downstream calls.
5. Unsupported scope / human approval / Max Turns => zero provider calls.
6. Existing Reply => no overwrite.
7. Forced timeout => `INTERRUPTED`.
8. Expired lease => one recovery worker; stale worker cannot complete.
9. Prompt requesting production data/secrets => no access and explicit missing-visibility response.
10. Secret scan/log review => no credentials or sensitive payloads.
11. Cost breaker test => provider call blocked at configured threshold.
12. Vault production systems remain untouched throughout.

The detailed security analysis is in `docs/MARCO_DIALOG_THREAT_MODEL.md`.
