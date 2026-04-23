-- ═══════════════════════════════════════════════════════════════════════════
-- JobQuest schema — authoritative baseline
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This file is the single source of truth for the DB schema. Running it on a
-- fresh Supabase project creates everything the app needs. Running it on an
-- existing project is a no-op (every statement is idempotent).
--
-- Design decisions:
--   * `public.users` is the app's own user table (NextAuth + bcrypt). All
--     user-scoped FKs reference public.users(id), NOT auth.users.
--   * `jobs.job_type` is plain `text` (no enum) — sources return heterogeneous
--     strings and a strict enum caused silent insert failures.
--   * `application_status_enum` and `resume_type_enum` remain enums because
--     their values exactly match the TypeScript unions in lib/types.ts.
--   * RLS is enabled with no policies so the anon public key can't read/write
--     user-scoped data. All server code uses the service_role key which
--     bypasses RLS.
--
-- Legacy columns (jobs.url, is_funded, deadline, saved_at) are preserved to
-- match the current production DB. See the "optional cleanup" block at the
-- bottom of this file if you want to drop them.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Orphan cleanup
-- ─────────────────────────────────────────────────────────────────────────────
-- enrollment_flag_enum was dropped as a column in the 002 refactor but the
-- type itself was never removed. Safe to drop since nothing references it.
DROP TYPE IF EXISTS enrollment_flag_enum;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums that survived (match TS unions in lib/types.ts)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'application_status_enum') THEN
    CREATE TYPE application_status_enum AS ENUM (
      'saved', 'applied', 'phone_screen', 'interview', 'offer', 'rejected', 'withdrawn'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resume_type_enum') THEN
    CREATE TYPE resume_type_enum AS ENUM ('master', 'variant', 'customized');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. users — custom auth table (NextAuth CredentialsProvider + bcrypt)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  username            text UNIQUE,
  email               text UNIQUE,
  password_hash       text NOT NULL,
  name                text,
  xp                  integer NOT NULL DEFAULT 0,
  level               integer NOT NULL DEFAULT 1,
  streak_days         integer NOT NULL DEFAULT 0,
  last_active         timestamptz,
  google_drive_token  jsonb,
  created_at          timestamptz DEFAULT now()
);

-- Backfill missing columns on pre-existing tables (idempotent)
ALTER TABLE users ADD COLUMN IF NOT EXISTS username           text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_drive_token jsonb;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_username_key') THEN
    ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_key') THEN
    ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. jobs — canonical, not per-user
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  canonical_title  text NOT NULL,
  company          text NOT NULL,
  location         text,
  description      text,
  salary_min       integer,
  salary_max       integer,
  salary_currency  text DEFAULT 'USD',
  job_type         text DEFAULT 'full-time',
  employment_type  text,
  is_phd           boolean DEFAULT false,
  posted_at        timestamptz,
  scraped_at       timestamptz DEFAULT now(),
  expires_at       timestamptz,
  status           text DEFAULT 'active',
  raw_hash         text,
  metadata         jsonb,

  -- Legacy columns (preserved to match production DB; see optional-cleanup block)
  url              text,
  is_funded        boolean,
  deadline         date,
  saved_at         timestamptz DEFAULT now()
);

-- Backfill every column idempotently (so existing DBs get missing ones)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS canonical_title  text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company          text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS location         text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description      text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_min       integer;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_max       integer;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_currency  text DEFAULT 'USD';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_type         text DEFAULT 'full-time';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS employment_type  text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_phd           boolean DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posted_at        timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scraped_at       timestamptz DEFAULT now();
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS expires_at       timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status           text DEFAULT 'active';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS raw_hash         text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS metadata         jsonb;

-- If `job_type` was previously an enum, demote it to plain text.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='jobs'
      AND column_name='job_type' AND data_type='USER-DEFINED'
  ) THEN
    EXECUTE 'ALTER TABLE jobs ALTER COLUMN job_type TYPE text USING job_type::text';
    EXECUTE 'ALTER TABLE jobs ALTER COLUMN job_type SET DEFAULT ''full-time''';
    DROP TYPE IF EXISTS job_type_enum;
  END IF;
END $$;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS jobs_raw_hash_idx  ON jobs (raw_hash);
CREATE INDEX        IF NOT EXISTS jobs_metadata_gin  ON jobs USING gin (metadata);
CREATE INDEX        IF NOT EXISTS jobs_status_idx    ON jobs (status);
CREATE INDEX        IF NOT EXISTS jobs_scraped_idx   ON jobs (scraped_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. job_sources — one row per platform a job appears on
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_sources (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid REFERENCES jobs(id) ON DELETE CASCADE,
  source_name    text NOT NULL,
  source_url     text NOT NULL,
  source_job_id  text,
  scraped_at     timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_sources_name_id_idx
  ON job_sources (source_name, source_job_id)
  WHERE source_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_sources_job_idx ON job_sources (job_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. job_scores — Claude fit analysis per user
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_scores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid REFERENCES jobs(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES public.users(id) ON DELETE CASCADE,
  fit_score       integer CHECK (fit_score BETWEEN 0 AND 100),
  fit_reason      text,
  skills_matched  text[],
  skills_missing  text[],
  recommended     boolean,
  scored_at       timestamptz DEFAULT now(),
  UNIQUE (job_id, user_id)
);

CREATE INDEX IF NOT EXISTS job_scores_user_score_idx ON job_scores (user_id, fit_score DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. applications — user-tracked application status
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           uuid REFERENCES public.users(id) ON DELETE CASCADE,
  job_id            uuid REFERENCES jobs(id)         ON DELETE CASCADE,
  status            application_status_enum DEFAULT 'saved',
  applied_at        timestamptz,
  drive_folder_url  text,
  resume_version    text,
  notes             text,
  xp_awarded        integer DEFAULT 0,
  updated_at        timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS applications_user_idx ON applications (user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. resume_versions — master / variant / customized
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resume_versions (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        uuid REFERENCES public.users(id) ON DELETE CASCADE,
  job_id         uuid REFERENCES jobs(id)         ON DELETE SET NULL,
  type           resume_type_enum DEFAULT 'customized',
  variant_name   text,
  content        text,
  is_default     boolean NOT NULL DEFAULT false,
  ats_score      integer,
  drive_file_id  text,
  drive_url      text,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resume_versions_user_idx ON resume_versions (user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. resumes — parsed active-resume snapshot (used by search scoring)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resumes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES public.users(id) ON DELETE CASCADE,
  parsed_skills      text[],
  parsed_experience  jsonb,
  parsed_education   jsonb,
  is_active          boolean DEFAULT true,
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resumes_user_active_idx ON resumes (user_id, is_active);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. search_configs — user's saved search profiles
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_configs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES public.users(id) ON DELETE CASCADE,
  name               text,
  keywords           text[],
  target_companies   text[],
  locations          text[],
  sources            text[],
  career_page_urls   text[],
  schedule_interval  text DEFAULT 'daily',
  last_run_at        timestamptz,
  is_active          boolean DEFAULT true,
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS search_configs_user_idx ON search_configs (user_id, is_active);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. search_runs — audit log per scrape
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES public.users(id)   ON DELETE CASCADE,
  config_id     uuid REFERENCES search_configs(id) ON DELETE SET NULL,
  started_at    timestamptz DEFAULT now(),
  completed_at  timestamptz,
  jobs_found    integer DEFAULT 0,
  jobs_new      integer DEFAULT 0,
  jobs_scored   integer DEFAULT 0,
  status        text DEFAULT 'running',
  error_text    text,
  apify_run_ids jsonb
);

CREATE INDEX IF NOT EXISTS search_runs_user_idx ON search_runs (user_id, started_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. achievements — unlocked badges per user
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS achievements (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid REFERENCES public.users(id) ON DELETE CASCADE,
  badge_key  text NOT NULL,
  earned_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, badge_key)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. professor_watchlist — legacy, preserved for compatibility
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS professor_watchlist (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid REFERENCES public.users(id) ON DELETE CASCADE,
  professor_name  text NOT NULL,
  university      text,
  lab_name        text,
  research_area   text,
  profile_url     text,
  notes           text,
  created_at      timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Row-level security
--     No policies → anon public key is blocked. Server uses service_role which
--     bypasses RLS. Defense-in-depth only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE resumes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_scores           ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_configs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE professor_watchlist  ENABLE ROW LEVEL SECURITY;

-- Drop any leftover auth.uid()-based policies from earlier attempts
DROP POLICY IF EXISTS job_scores_own     ON job_scores;
DROP POLICY IF EXISTS search_configs_own ON search_configs;
DROP POLICY IF EXISTS search_runs_own    ON search_runs;
DROP POLICY IF EXISTS "Users manage own jobs" ON jobs;

-- ═══════════════════════════════════════════════════════════════════════════
-- OPTIONAL CLEANUP — uncomment and run once to drop legacy columns
-- ═══════════════════════════════════════════════════════════════════════════
-- These columns are holdovers from the pre-multi-source schema. Nothing in the
-- current codebase reads or writes them. Dropping is one-way; back up first
-- if you might still have data you care about in those columns.
--
-- ALTER TABLE jobs DROP COLUMN IF EXISTS url;
-- ALTER TABLE jobs DROP COLUMN IF EXISTS is_funded;
-- ALTER TABLE jobs DROP COLUMN IF EXISTS deadline;
-- ALTER TABLE jobs DROP COLUMN IF EXISTS saved_at;
--
-- DROP TABLE IF EXISTS professor_watchlist;   -- unused by current code
