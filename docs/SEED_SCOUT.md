# SEED Scout Foundation

SEED is the persistent consultant intelligence layer for Vault Verified. It does not alter immutable Vault records. It discovers, scores, remembers, and queues growth opportunities for human approval.

## Plug-in map

- **LEAD** → `seed_consultants`
- **DATA** → `seed_observations`
- **OUTREACH** → `seed_actions`
- **SYSTEM / MARCO OS** → `agent_runs`
- **VAULT** remains unchanged and only receives records through its governed filing process.

## What the first agent does

`/api/agents/seed-scout`

1. Accepts candidate consultants from approved discovery feeds or a direct API payload.
2. Creates one persistent identity per platform and handle.
3. Scores the opportunity from public-pick availability, audience size, contact availability, and recent activity.
4. Preserves each observation with a source fingerprint.
5. Queues an outreach-draft action when the score reaches 70.
6. Records every execution in an idempotent agent-run ledger.

The agent does **not** send messages, publish content, or create Vault records automatically. Those remain approval-gated.

## Required setup

Run the migration:

`supabase/migrations/20260731_seed_scout_foundation.sql`

Add these Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AGENT_SECRET`
- `CRON_SECRET` — set this to the same value as `AGENT_SECRET` for the scheduled request
- `SEED_DISCOVERY_FEEDS_JSON` — optional JSON array of approved feed definitions

Example discovery-feed configuration:

```json
[
  {
    "name": "approved-consultant-feed",
    "url": "https://example.com/api/consultants"
  }
]
```

A feed may return an array directly or an object with `items` or `candidates`.

## Candidate contract

```json
{
  "platform": "instagram",
  "handle": "exampleconsultant",
  "display_name": "Example Consultant",
  "profile_url": "https://example.com/profile",
  "follower_count": 12000,
  "public_picks_detected": true,
  "contact_available": true,
  "recent_activity": true,
  "source_url": "https://example.com/public-post",
  "last_public_activity_at": "2026-07-31T06:00:00Z",
  "metadata": {}
}
```

## Manual test

```bash
curl -X POST https://vaultverified.app/api/agents/seed-scout \
  -H "Authorization: Bearer $AGENT_SECRET" \
  -H "X-Run-Key: seed-scout:manual:001" \
  -H "Content-Type: application/json" \
  -d '{"candidates":[{"platform":"instagram","handle":"exampleconsultant","public_picks_detected":true,"recent_activity":true}]}'
```

Health check:

```bash
curl "https://vaultverified.app/api/agents/seed-scout?health=1"
```

## Daily operating output

MARCO OS should query:

- highest-scoring `outreach_ready` seeds
- pending `seed_actions`
- new observations since the previous run
- failed or partial `agent_runs`

The resulting executive brief should answer only:

1. Who deserves attention today?
2. What public evidence changed?
3. Which action is ready for approval?
4. What failed and requires intervention?

## Next agents

Build in this order:

1. **Outreach Draft Agent** — converts approved `seed_actions` into personalized drafts.
2. **Public Pick Observer** — creates reviewable candidate observations, never Vault records directly.
3. **Publisher** — turns finalized Vault events into channel-specific content drafts.
4. **Executive Brief** — ranks the day's actions for MARCO OS.
