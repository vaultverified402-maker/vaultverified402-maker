# Marco OS Near-Immediate AI Dialogue Dispatcher

## Goal

Remove Marco from the manual `check` loop while keeping the Notion AI Handoff Queue as the authoritative communication and audit ledger.

The target boundary is:

- **Marco OS** — orchestration and governance
- **Notion AI Handoff Queue** — communication and durable audit trail
- **OpenAI / Claude** — reasoning workers
- **Vault Verified** — downstream governed system, never touched unless a separate handoff explicitly authorizes it

This draft does **not** merge or deploy production infrastructure.

## Event-driven runtime

The hosted draft lives at:

`supabase/functions/marco-ai-dialogue-dispatcher/index.ts`

The preferred trigger is a Notion connection webhook rather than short-interval polling. Subscribe the connection to `page.created` and `page.properties_updated`. Notion sends a secure POST to the Edge Function, which retrieves the changed page and ignores anything outside the AI Handoff Queue.

This removes the Termux/local-process dependency and avoids a permanent polling loop.

## Trust boundary

The dispatcher may write only these queue lifecycle fields:

- `Status`
- `Claimed By`
- `Claimed At`
- `Reply`
- `Model`
- `Turn Count`

The initial autonomous MVP intentionally supports only `Scope = Notion only`. It does not give provider API calls GitHub, Supabase, Vercel, Gmail, filesystem, or other connected tools. If a queue turn requires external system visibility, the worker must state that the visibility is missing rather than pretend it inspected that system.

The dispatcher fails closed when:

- `Requires Human Approval = true`
- `Authorization` is not explicitly supported
- `Scope` contains anything beyond `Notion only` in the MVP
- `Turn Count >= Max Turns`
- `Claimed By` is already populated
- the target provider is not configured
- the provider times out, errors, or returns malformed/empty output

Provider failure is written as `INTERRUPTED`, not `REPLIED`.

## Provider invocation

The hosted dispatcher calls provider APIs directly. It does not invoke Claude Code, Codex, Termux, or a local shell.

Required runtime secrets/configuration:

```text
NOTION_API_KEY
NOTION_HANDOFF_DATA_SOURCE_ID
NOTION_WEBHOOK_VERIFICATION_TOKEN
OPENAI_API_KEY
OPENAI_MODEL
ANTHROPIC_API_KEY
ANTHROPIC_MODEL
```

No live key or token belongs in GitHub.

The provider calls are deliberately text-only for the first pilot. They receive the governed Task and Message plus authorization/scope metadata and return only Reply text.

## Notion webhook setup

1. Deploy the Marco OS Edge Function to a **dedicated Marco OS runtime**, not the live Vault Verified project.
2. In the Notion connection used for the AI Handoff Queue, create a webhook subscription pointing to the function URL.
3. Subscribe to `page.created` and `page.properties_updated`.
4. Complete Notion's one-time verification flow and store the verification token as `NOTION_WEBHOOK_VERIFICATION_TOKEN` in the runtime secret store.
5. Keep signature verification enabled. The function rejects unsigned/invalid webhook events.

## Claim discipline

Notion page updates are not a database compare-and-swap primitive, so the pilot uses a single dispatcher instance and re-reads the page after claiming it. A turn proceeds only if:

- it was `QUEUED`
- `Claimed By` was empty
- the re-read shows `Status = IN_PROGRESS`
- `Claimed By = Marco OS Hosted Dispatcher`

A single dispatcher plus re-read verification minimizes duplicate execution. Before scaling beyond one worker, add a stronger idempotency/lease layer.

## Conversation behavior

A provider reply is written back to the current queue item. For continued model-to-model dialogue, the orchestration layer should create a new governed queue turn addressed to the other model only when another response is required.

Every new turn must preserve:

- explicit `To`
- `Authorization`
- `Scope`
- `Requires Human Approval`
- `Max Turns`
- `Max Runtime Seconds`

No uncontrolled ping-pong is allowed.

## Infrastructure state as of this draft

There is currently no dedicated Marco OS GitHub repository and no dedicated Marco OS Supabase project. The connected Supabase account contains the live `vaultverified` project plus inactive Vault seed-scout projects. None should be repurposed silently.

Therefore the implementation can be reviewed and tested as code in draft PR #13, but hosted deployment should wait for an explicit choice of a dedicated Marco OS runtime.

## Pilot acceptance criteria

Before any merge/deployment approval:

1. Claude reviews the hosted Edge Function diff.
2. No secrets are committed.
3. A dedicated non-production Marco OS runtime is selected.
4. Provider API credentials are configured only in that runtime's secret store.
5. A Notion-only smoke-test turn moves deterministically through `QUEUED → IN_PROGRESS → REPLIED`.
6. Timeout/malformed response proves `INTERRUPTED` behavior.
7. Duplicate webhook delivery does not produce a second provider call after the turn leaves `QUEUED`.
8. Vault Verified production tables, functions, billing, grading, records, and distribution remain untouched.

## Legacy local prototype

`tools/ai_dialogue_relay.py` remains in the draft branch only as an earlier prototype for comparison. It is **not** the target deployment architecture and should be removed or archived before merge once the hosted design is accepted.
