-- Migration: workday_registry
-- Moves user-added Workday tenant entries from the in-memory file (ats-resolver.ts)
-- to a proper database table so changes persist without requiring a server restart.

create table if not exists workday_registry (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  key        text not null,           -- lowercased, stripped company name (e.g. 'qualcomm')
  tenant     text not null,           -- e.g. 'qualcomm'
  dc         text not null,           -- e.g. 'wd5'
  site       text not null,           -- e.g. 'External'
  created_at timestamptz not null default now(),
  unique (user_id, key)
);

-- Index for fast per-user lookups in the pipeline
create index if not exists workday_registry_user_id_idx on workday_registry (user_id);
