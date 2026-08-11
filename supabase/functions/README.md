# Supabase Edge Functions

This directory is the source-controlled snapshot of the live GG402 distribution functions in Supabase project `apmrgvpegtfsqqjcokfv`.

Tracked here:

- `process-distribution-job` — live v19 dispatcher. FREE routes through `GG402_DISCORD_WEBHOOK_URL`; PREMIUM routes through `GG402_PREMIUM_DISCORD_WEBHOOK_URL`; INTERNAL suppresses. Whop is not a required publishing destination in v19.
- `gg402-dispatch-cron-proxy` — cron authentication/proxy layer.
- `gg402-whop-discover-channel` — dormant Whop channel discovery utility.
- `gg402-whop-send-test` — dormant Whop validation-send utility.

Secrets are intentionally not stored in GitHub. Runtime credentials remain in Supabase Edge Function Secrets.

Before changing production behavior, compare the repository copy to the currently deployed Supabase function and review the diff. The repository should become the canonical editable source; Supabase remains the runtime deployment target.
