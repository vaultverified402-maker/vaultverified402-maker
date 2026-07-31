# SEED Scout Foundation

SEED is the persistent consultant intelligence layer for Vault Verified. It discovers, scores, remembers, and queues growth opportunities. It cannot write to Vault records, consultant profiles, applications, grading tables, or governance evidence.

## Governance boundary

- **LEAD** → `seed_consultants`
- **DATA** → append-only `seed_observations`
- **OUTREACH** → idempotent `seed_actions`
- **SYSTEM / MARCO OS** → leased `agent_runs`
- **VAULT** → unchanged; enrollment and record filing require separate governed workflows

The boundary is enforced in Postgres:

- Scout has no table privileges.
- Scout can execute only five functions in the non-exposed `private` schema.
- `seed_observations` rejects every update and delete through a trigger.
- Foreign keys use `ON DELETE RESTRICT`.
- No `vault_profile_id` bridge exists in SEED.
- Anonymous, authenticated, service-role, and public access are revoked from the SEED tables and private Scout functions.

## Scoped database role

The migration creates the group role `seed_scout_runtime` as `NOLOGIN`. After reviewing and running the migration, create a separate login credential with a generated password:

```sql
create role seed_scout_login
  login
  password '<GENERATED_RANDOM_PASSWORD>';

grant seed_scout_runtime to seed_scout_login;
```

Use the Supabase transaction-pooler connection string for that login as `SCOUT_DATABASE_URL`. The runtime credential inherits only `USAGE` on `private` and `EXECUTE` on:

- `private.scout_upsert_candidate(jsonb)`
- `private.scout_append_observation(...)`
- `private.scout_queue_action(...)`
- `private.scout_begin_run(...)`
- `private.scout_finish_run(...)`

Do not configure `SUPABASE_SERVICE_ROLE_KEY` for Scout.

## Endpoint behavior

`/api/agents/seed-scout`

1. Authenticates the scheduled or manual request with `AGENT_SECRET`.
2. Acquires a leased run using a caller-supplied run key.
3. Normalizes platform and handle into one persistent `seed_key`.
4. Scores the opportunity.
5. Builds a stable observation fingerprint from canonical source identity fields.
6. Appends the observation through the private RPC.
7. Queues one action per action type and triggering observation fingerprint.
8. Finishes the owned run with counts and errors.

The agent does **not** send outreach, publish content, enroll consultants, create profiles, or create Vault records.

## Required environment variables

- `SCOUT_DATABASE_URL` — scoped `seed_scout_login` pooler URL
- `AGENT_SECRET`
- `CRON_SECRET` — same value as `AGENT_SECRET` for Vercel Cron
- `SEED_DISCOVERY_FEEDS_JSON` — optional approved HTTPS feeds

## Candidate evidence contract

A source should supply stable public-evidence identifiers when available:

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
  "source_post_id": "platform-post-123",
  "published_at": "2026-07-31T06:00:00Z",
  "evidence_key": "selection-or-evidence-id",
  "metadata": {}
}
```

The fingerprint uses:

- normalized seed identity
- observation type
- canonical source URL
- source post or publication ID
- publication timestamp
- evidence key

Follower-count and arbitrary metadata changes do not create a new evidence identity.

## Manual test

```bash
curl -X POST https://vaultverified.app/api/agents/seed-scout \
  -H "Authorization: Bearer $AGENT_SECRET" \
  -H "X-Run-Key: seed-scout:manual:001" \
  -H "Content-Type: application/json" \
  -d '{"candidates":[{"platform":"instagram","handle":"exampleconsultant","public_picks_detected":true,"recent_activity":true,"source_post_id":"post-001"}]}'
```

Run the identical request twice with the same run key. The second request must not own or repeat the completed run. Then use a new run key with the same evidence and confirm that neither the observation nor action duplicates.

## Required database verification before merge

1. Attempt `UPDATE` and `DELETE` against `seed_observations`; both must fail.
2. Attempt deletion of a seed with observations or actions; it must fail.
3. Connect as `seed_scout_login`; direct table reads and writes must fail.
4. Execute each granted private function as `seed_scout_login`; only valid scoped operations must succeed.
5. Confirm `service_role` is not configured in the Vercel function.
6. Run the same observation under two run keys; observation and action counts must remain one.
7. Test concurrent acquisition of one run key; only one owner token may acquire the lease.
8. Run Supabase database security and performance advisors.

## Activation sequence

1. Review the migration and this document.
2. Test the migration on a disposable or branch database.
3. Create the scoped login and configure `SCOUT_DATABASE_URL` only in Preview.
4. Test endpoint authorization, deduplication, leases, and failure recovery.
5. Review database advisors and Preview logs.
6. Merge only after the verification matrix passes.
7. Configure Production secrets and enable the schedule last.
