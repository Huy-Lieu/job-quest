// lib/context.ts
// Shared data assembler — reads job row, fit score, and company intel from DB
// in parallel. Never calls Claude. Returns nulls for fields not yet stored.
// Call from API routes or server code that need one consistent payload (optional).

import { supabaseAdmin } from '@/lib/supabase'
import type { Seniority, RoleType, JobScore, JobSource, IntelSignal, RoleCompanyIntel } from '@/lib/types'

// ── output shape ──────────────────────────────────────────────────────────────

export interface CompanySnapshot {
  stage:         string | null
  headcount:     string | null
  revenue:       string | null
  core_business: string | null
  key_products:  string | null
}

export interface CompanyIntel {
  company_name:        string
  summary:             string | null
  recent_news:         { headline: string; date: string; url: string; summary: string }[] | null
  strategic_direction: string | null
  hiring_signals:      string | null
  red_flags:           string | null
  fetched_at:          string
  expires_at:          string
  // Structured fields from new 3-query synthesis (null for legacy cached rows)
  company_snapshot:    CompanySnapshot | null
  strategic_signals:   IntelSignal[] | null
  leadership_culture:  IntelSignal[] | null
}

export interface JobContext {
  // Core job fields
  id:                   string
  canonical_title:      string
  company:              string
  location:             string | null
  description:          string | null
  salary_min:           number | null
  salary_max:           number | null
  salary_currency:      string | null
  job_type:             string | null
  employment_type:      string | null
  is_phd:               boolean
  posted_at:            string | null
  scraped_at:           string | null
  status:               string | null
  apply_url:            string | null
  role_alignment:       string | null

  // Enriched fields (null = not yet enriched)
  role_summary:         string | null
  skills_required:      string[] | null
  skills_preferred:     string[] | null
  tech_stack:           string[] | null
  work_mode:            string | null
  visa_sponsorship:     string | null
  experience_years_min: number | null
  experience_years_max: number | null
  education_level:      string | null
  security_clearance:   string | null
  benefits_highlights:  string[] | null
  languages_required:   string[] | null
  seniority_level:      Seniority | null
  role_type:            RoleType | null
  enriched_at:          string | null

  // Per-job role-level company intel
  role_company_intel:   RoleCompanyIntel | null

  // Fit score (null = not yet scored for this user)
  fitScore: JobScore | null

  // Sources
  sources: JobSource[]

  // Company intel (null = not yet fetched or expired)
  companyIntel: CompanyIntel | null
}

// ── internal row types (Supabase untyped client) ──────────────────────────────

interface JobRow {
  id:                   string
  canonical_title:      string
  company:              string
  location:             string | null
  description:          string | null
  salary_min:           number | null
  salary_max:           number | null
  salary_currency:      string | null
  job_type:             string | null
  employment_type:      string | null
  is_phd:               boolean
  posted_at:            string | null
  scraped_at:           string | null
  status:               string | null
  apply_url:            string | null
  role_alignment:       string | null
  role_summary:         string | null
  skills_required:      string[] | null
  skills_preferred:     string[] | null
  tech_stack:           string[] | null
  work_mode:            string | null
  visa_sponsorship:     string | null
  experience_years_min: number | null
  experience_years_max: number | null
  education_level:      string | null
  security_clearance:   string | null
  benefits_highlights:  string[] | null
  languages_required:   string[] | null
  seniority_level:      string | null
  role_type:            string | null
  enriched_at:          string | null
  role_company_intel:   RoleCompanyIntel | null
  job_sources:          { source_name: string; source_url: string }[]
}

interface ScoreRow {
  fit_score:      number
  fit_reason:     string | null
  skills_matched: string[] | null
  skills_missing: string[] | null
  recommended:    boolean
}

interface IntelRow {
  company_name:        string
  summary:             string | null
  recent_news:         { headline: string; date: string; url: string; summary: string }[] | null
  strategic_direction: string | null
  hiring_signals:      string | null
  red_flags:           string | null
  fetched_at:          string
  expires_at:          string
  company_snapshot:    CompanySnapshot | null
  strategic_signals:   IntelSignal[] | null
  leadership_culture:  IntelSignal[] | null
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * Load all available data for a job from the database in parallel.
 * Never calls Claude — purely reads from Supabase.
 * Returns nulls for anything not yet computed (unenriched, unscored, no intel).
 */
export async function buildJobContext(
  jobId: string,
  userId: string
): Promise<JobContext> {
  // Fire job + score queries in parallel
  const [jobResult, scoreResult] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabaseAdmin as any)
      .from('jobs')
      .select(
        'id, canonical_title, company, location, description, ' +
        'salary_min, salary_max, salary_currency, job_type, employment_type, ' +
        'is_phd, posted_at, scraped_at, status, apply_url, role_alignment, ' +
        'role_summary, skills_required, skills_preferred, tech_stack, work_mode, ' +
        'visa_sponsorship, experience_years_min, experience_years_max, ' +
        'education_level, security_clearance, benefits_highlights, ' +
        'languages_required, seniority_level, role_type, enriched_at, ' +
        'role_company_intel, job_sources(source_name, source_url)'
      )
      .eq('id', jobId)
      .maybeSingle() as Promise<{ data: JobRow | null; error: unknown }>,

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabaseAdmin as any)
      .from('job_scores')
      .select('fit_score, fit_reason, skills_matched, skills_missing, recommended')
      .eq('job_id', jobId)
      .eq('user_id', userId)
      .maybeSingle() as Promise<{ data: ScoreRow | null; error: unknown }>,
  ])

  const job = jobResult.data
  if (!job) {
    throw new Error('Job not found: ' + jobId)
  }

  // Fetch company intel after we have job.company
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const intelResult: { data: IntelRow | null } = await (supabaseAdmin as any)
    .from('company_intel')
    .select(
      'company_name, summary, recent_news, strategic_direction, ' +
      'hiring_signals, red_flags, fetched_at, expires_at, ' +
      'company_snapshot, strategic_signals, leadership_culture'
    )
    .eq('company_name', job.company)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  const score = scoreResult.data
  const intel = intelResult.data
  const sources: JobSource[] = (job.job_sources ?? []) as JobSource[]

  return {
    // Core
    id:                   job.id,
    canonical_title:      job.canonical_title,
    company:              job.company,
    location:             job.location,
    description:          job.description,
    salary_min:           job.salary_min,
    salary_max:           job.salary_max,
    salary_currency:      job.salary_currency,
    job_type:             job.job_type,
    employment_type:      job.employment_type,
    is_phd:               job.is_phd ?? false,
    posted_at:            job.posted_at,
    scraped_at:           job.scraped_at,
    status:               job.status,
    apply_url:            job.apply_url,
    role_alignment:       job.role_alignment,

    // Enriched
    role_summary:         job.role_summary,
    skills_required:      job.skills_required,
    skills_preferred:     job.skills_preferred,
    tech_stack:           job.tech_stack,
    work_mode:            job.work_mode,
    visa_sponsorship:     job.visa_sponsorship,
    experience_years_min: job.experience_years_min,
    experience_years_max: job.experience_years_max,
    education_level:      job.education_level,
    security_clearance:   job.security_clearance,
    benefits_highlights:  job.benefits_highlights,
    languages_required:   job.languages_required,
    seniority_level:      (job.seniority_level as Seniority) ?? null,
    role_type:            (job.role_type as RoleType) ?? null,
    enriched_at:          job.enriched_at,

    // Role-level company intel
    role_company_intel:   job.role_company_intel ?? null,

    // Fit score
    fitScore: score
      ? {
          fit_score:      score.fit_score,
          fit_reason:     score.fit_reason,
          skills_matched: score.skills_matched ?? [],
          skills_missing: score.skills_missing ?? [],
          recommended:    score.recommended,
        }
      : null,

    // Sources
    sources,

    // Company intel
    companyIntel: intel
      ? {
          company_name:        intel.company_name,
          summary:             intel.summary,
          recent_news:         intel.recent_news,
          strategic_direction: intel.strategic_direction,
          hiring_signals:      intel.hiring_signals,
          red_flags:           intel.red_flags,
          fetched_at:          intel.fetched_at,
          expires_at:          intel.expires_at,
          company_snapshot:    intel.company_snapshot ?? null,
          strategic_signals:   intel.strategic_signals ?? null,
          leadership_culture:  intel.leadership_culture ?? null,
        }
      : null,
  }
}
