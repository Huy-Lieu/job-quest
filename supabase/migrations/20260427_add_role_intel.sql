-- Migration: add role_intel JSONB column to jobs table
-- Phase 2 of JD Intelligence architecture
--
-- role_intel stores structured candidate-facing intelligence extracted by
-- Claude Haiku at enrichment time. All fields are sourced strictly from
-- the job description text -- no outside knowledge or hallucination.
--
-- Schema matches lib/claude/enricher.ts RoleIntel interface:
-- {
--   role_translation: { day_to_day, problem_solved, ownership_level,
--                        year1_success, team_context, work_rhythm },
--   ats_keywords:     string[],
--   hiring_signals:   { is_backfill, level_flexibility, urgency_note,
--                        culture_signals, interview_hints }
-- }
--
-- Existing rows default to NULL and will populate on next enrichment run.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS role_intel JSONB DEFAULT NULL;

-- Index for any future queries filtering on role_intel fields
-- (e.g. finding all backfill roles, or roles with level flexibility)
CREATE INDEX IF NOT EXISTS jobs_role_intel_idx
  ON jobs USING GIN (role_intel)
  WHERE role_intel IS NOT NULL;
