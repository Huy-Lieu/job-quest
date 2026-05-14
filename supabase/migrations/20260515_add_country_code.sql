-- Add country_code column to jobs table
-- Populated by the normalize pipeline stage (lib/pipeline/normalize.ts)

alter table jobs
  add column if not exists country_code text;
