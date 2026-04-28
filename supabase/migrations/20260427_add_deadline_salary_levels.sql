-- Migration: add application_deadline and salary_levels columns to jobs
-- application_deadline: ISO date extracted from JD text (e.g. "Applications accepted until May 1, 2026")
-- salary_levels: per-level salary bands for roles that post multiple ranges (e.g. NVIDIA L4/L5)

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS application_deadline date,
  ADD COLUMN IF NOT EXISTS salary_levels        jsonb;

-- Index on application_deadline so we can efficiently find jobs closing soon
CREATE INDEX IF NOT EXISTS jobs_application_deadline_idx ON jobs (application_deadline)
  WHERE application_deadline IS NOT NULL;

COMMENT ON COLUMN jobs.application_deadline IS 'Application deadline extracted from JD text. NULL if not stated.';
COMMENT ON COLUMN jobs.salary_levels IS 'Per-level salary bands. E.g. [{"level":"L4","min":168000,"max":264500},{"level":"L5","min":196000,"max":310500}]. NULL when only one band or salary not stated.';
