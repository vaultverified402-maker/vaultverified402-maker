# Authenticated and Owner Path Audit — 2026-08-03

## Scope

Audit remaining application dependencies on direct `public.profiles` and `public.records` access before raw-table privilege revocation.

No database privileges, RLS policies, schema objects, production files, or Vercel settings were changed during this audit.

## Repository findings

### Public browser pages

- `index.html` reads `v_public_platform_stats`, `v_public_records`, and `v_public_consultants`.
- `records.html` reads `v_public_records` and `v_public_consultants`.
- `consultant.html` reads `v_public_records` and `v_public_consultants`.
- `archive.html` reads `v_public_archive_summary` and `v_public_archive_records`.
- `create-archive.html` writes through the `create-archive` Supabase Edge Function rather than directly reading or writing `profiles` or `records`.
- `apply.html` writes to `consultant_applications`, not `profiles` or `records`.

### Authenticated browser paths

The current production repository contains no Supabase Auth login/session flow and no browser page using a user JWT to read `profiles` or `records` directly. No authenticated consultant dashboard or owner portal is present in this repository.

Result: no repository-level authenticated read path was found that requires direct `SELECT` on `public.profiles` or `public.records`.

### Owner/service paths

Database-owned and service-role operations remain separate from browser access. Existing RLS policies permit service-role inserts/updates, and server-side functions operate under their configured owner/security context. Revoking raw-table privileges from `anon` and `authenticated` must not revoke privileges from `service_role`, `postgres`, or database object owners.

## Database findings

### Current grants

Both `anon` and `authenticated` currently hold broad table privileges on `public.profiles` and `public.records`, including `SELECT`, despite RLS limiting effective row access. These grants are broader than the application requires.

### Current SELECT policies

- `profiles_select_public` permits `anon`, `authenticated`, and `service_role` to select rows where `visibility = 'public'`.
- `records_select_public` applies to `public` and permits records whose profile is public.

Because table-level `SELECT` remains granted, clients can query every column allowed by those policies, including columns not projected by the public views.

### Functions depending on raw tables

The database contains functions that reference `public.profiles` or `public.records`, including:

- `public.promote_ai_analysis(...)` — `SECURITY DEFINER`
- `public.recompute_profile_stats(text)` — invoker
- `public.sync_profile_stats()` — invoker

These are database/internal dependencies, not authenticated browser reads. Their execution grants and callers must be reviewed separately before changing service-role or owner privileges. They do not justify retaining direct table `SELECT` for `anon` or `authenticated`.

## Classification

| Path | Access class | Direct raw-table dependency | Revocation impact |
|---|---|---:|---|
| Public homepage | anon/public | No | None expected |
| Public records page | anon/public | No | None expected |
| Public consultant page | anon/public | No | None expected |
| Public archive page | anon/public | No | None expected |
| Archive creation | Edge Function | No browser dependency | Must smoke-test function after revocation |
| Consultant application | anon insert to `consultant_applications` | No | None expected |
| Authenticated consultant/owner browser flow | Not present | None found | No current dependency found |
| Internal/service operations | service/database owner | Yes, in functions and operational tooling | Preserve service/owner access |

## Audit conclusion

The repository audit found no current public or authenticated browser path that requires direct `SELECT` on `public.profiles` or `public.records`.

The next security change can therefore be scoped to:

```sql
revoke select on table public.profiles from anon, authenticated;
revoke select on table public.records from anon, authenticated;
```

This is a proposed migration, not yet applied.

Do not revoke from `service_role`, `postgres`, or object owners in the same change.

## Required validation before production application

1. Capture current direct-table responses as `anon` for a known public profile and record.
2. Confirm all public views remain selectable by `anon` and `authenticated`.
3. Apply the two `REVOKE SELECT` statements in a controlled migration.
4. Confirm direct REST requests to `/rest/v1/profiles` and `/rest/v1/records` fail for the publishable key.
5. Smoke-test homepage, records, consultant, and archive pages.
6. Smoke-test `create-archive` and application submission.
7. Verify service-role grading, profile-stat synchronization, filing, and administrative operations still function.
8. Review function EXECUTE grants separately; that broader function-hardening work is outside this two-table revocation.

## Status

**AUDIT COMPLETE — REVOCATION READY FOR CONTROLLED MIGRATION AND TESTING.**
