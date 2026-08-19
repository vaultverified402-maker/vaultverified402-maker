-- First-pick activation v1
-- Production migration applied 2026-08-19 via Supabase migration: first_pick_activation_v1.
-- This file mirrors the production migration for source control and review.

-- Creates public.first_pick_claims as a protected pre-event preservation layer.
-- Adds list_fileable_events(), list_first_pick_markets(), preserve_first_pick().
-- Adds an after-insert profile trigger that promotes the preserved first pick
-- into public.records using the original preserved_at timestamp once the
-- operator profile is activated.

-- Source of truth for the deployed SQL is the Supabase migration history.
