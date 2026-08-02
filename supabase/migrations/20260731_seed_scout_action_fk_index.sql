-- Cover the seed_actions foreign key used by parent integrity checks and seed-scoped action lookups.
create index if not exists seed_actions_seed_id_idx
  on public.seed_actions (seed_id);
