export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'phone_screen'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'

export type JobType    = 'full_time' | 'internship' | 'phd'
export type ResumeType = 'master' | 'variant' | 'customized'

// TrackedJob — shape returned by the applications API after migration 002.
// Canonical jobs no longer have title/url/user_id; those are now canonical_title
// and a job_sources row respectively.
export interface TrackedJob {
  id:              string
  canonical_title: string
  company:         string
  location:        string | null
  job_type:        string | null
  job_sources:     JobSource[]
}

export interface Application {
  id: string
  user_id: string
  job_id: string
  status: ApplicationStatus
  applied_at: string | null
  drive_folder_url: string | null
  resume_version: string | null
  notes: string | null
  xp_awarded: number
  created_at: string
  updated_at: string
  job?: TrackedJob
}

export interface Achievement {
  id: string
  user_id: string
  badge_key: string
  earned_at: string
}

export interface ResumeVersion {
  id: string
  user_id: string
  job_id: string | null
  type: ResumeType
  variant_name: string | null
  content: string | null
  is_default: boolean
  ats_score: number | null
  drive_file_id: string | null
  drive_url: string | null
  created_at: string
  job?: { canonical_title: string; company: string }
}

export interface AnalysisResult {
  jobAnalysis: string
  companyIntel: string | null
  gapAnalysis: string
  atsScore: number
  tailoredConservative: string
  tailoredAggressive: string
  prepBriefing: string
  coverLetter: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw source types — shapes returned by external scrapers before normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw shape returned by SerpAPI google_jobs engine.
 * Reference: https://serpapi.com/google-jobs-api
 */
export interface SerpJobResult {
  job_id:           string
  title:            string
  company_name:     string
  location:         string
  description:      string
  share_link:       string
  job_highlights?:  Array<{ title: string; items: string[] }>
  related_links?:   Array<{ text: string; link: string }>
  detected_extensions?: {
    posted_at?:        string   // e.g. "3 days ago"
    schedule_type?:    string   // "Full-time", "Part-time", etc.
    work_from_home?:   boolean
    salary?:           string   // free-form, e.g. "$120K–$160K a year"
  }
}

/**
 * Raw shape returned by Apify actors across all sources.
 * Fields are a superset union — each source populates a different subset.
 * The normalization layer (lib/pipeline/normalize.ts) maps these to NormalizedJob.
 */
export interface RawApifyJob {
  // Common across most sources
  title?:           string
  jobTitle?:        string
  name?:            string
  company?:         string
  companyName?:     string
  employer?:        string
  location?:        string
  jobLocation?:     string
  city?:            string
  description?:     string
  markdown?:        string
  text?:            string
  url?:             string
  jobUrl?:          string
  applyUrl?:        string
  link?:            string
  salary?:          string
  salaryRange?:     string
  salary_range?:    string
  compensation?:    string
  employmentType?:  string
  jobType?:         string
  workplaceType?:   string
  remote?:          string | boolean
  postedAt?:        string
  datePosted?:      string
  date?:            string
  posted_on?:       string
  published_on?:    string
  postedTime?:      string
  pubDate?:         string
  listedAt?:        string
  postedOn?:        string
  releasedDate?:    string
  first_published?: string
  updated_at?:      string
  source_job_id?:   string
  // LinkedIn-specific
  applicants_count?: number
  applicantsCount?:  number
  numApplicants?:    number | string
  // Allow arbitrary extra fields from actors
  [key: string]:    unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Apify pipeline types (new multi-source schema)
// ─────────────────────────────────────────────────────────────────────────────

export type SearchSourceName =
  | 'linkedin'
  | 'indeed'
  | 'google'
  | 'career_page'
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'glassdoor'
  | 'wellfound'
  | 'ziprecruiter'
  | 'phd'
  | 'workday'
  | 'smartrecruiters'
  | 'clearancejobs'
  | 'hn_hiring'
  | 'yc_waas'
  | 'workable'
  | 'recruitee'
  | 'teamtailor'
  | 'personio'
export type ScheduleInterval = 'daily' | '6h' | 'manual'
export type SearchRunStatus  = 'running' | 'complete' | 'failed'

export interface JobSource {
  source_name: SearchSourceName
  source_url:  string
}

export type Seniority = 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | 'manager' | 'director' | 'vp' | 'unknown'

export type RoleType = 'individual_contributor' | 'manager' | 'hybrid' | 'unknown'

export interface JobMetadata {
  // seniority, visa_sponsorship, skills, and benefits are now extracted by the
  // Claude Haiku enrichment pass and stored as first-class columns on jobs.
  years_required?:  number | null   // cheap regex heuristic, used pre-enrichment for dedup
  applicant_count?: number | null   // from LinkedIn API metadata
}

export interface JobScore {
  fit_score:      number
  fit_reason:     string | null
  skills_matched: string[]
  skills_missing: string[]
  recommended:    boolean
}

export interface JobWithScore {
  id:                   string
  canonical_title:      string
  company:              string
  location:             string | null
  description:          string | null
  salary_min:           number | null
  salary_max:           number | null
  salary_currency:      string
  job_type:             string | null   // full_time | contract | internship | part_time
  employment_type:      string | null   // remote | hybrid | on-site | unknown
  is_phd:               boolean
  posted_at:            string | null
  scraped_at:           string
  status:               string
  metadata:             JobMetadata | null
  job_scores:           JobScore[]
  job_sources:          JobSource[]
  // Enriched fields (written by Claude Haiku enrichment pass)
  role_summary:         string | null
  skills_required:      string[] | null
  skills_preferred:     string[] | null
  tech_stack:           string[] | null
  work_mode:            string | null
  visa_sponsorship:     string | null
  experience_years_min: number | null
  experience_years_max: number | null
  education_level:      string | null
  security_clearance:   'none' | 'preferred' | 'required' | null
  benefits_highlights:  string[] | null
  languages_required:   string[] | null
  seniority_level:      Seniority | null
  role_type:            RoleType | null
  enriched_at:          string | null
  // Candidate-facing JD intelligence (written by Claude Haiku enrichment pass)
  role_intel:           import('./claude/enricher').RoleIntel | null
  // Application deadline extracted from JD text (e.g. "Applications accepted until May 1, 2026")
  application_deadline: string | null   // ISO date string
  // Per-level salary ranges (e.g. NVIDIA L4/L5). Single range stored in salary_min/max.
  salary_levels:        Array<{ level: string; min: number; max: number }> | null
  // Per-job role-level company intel (synthesized by Claude Sonnet)
  role_company_intel:   RoleCompanyIntel | null
}

export interface IntelSignal {
  text:      string
  sentiment: 'positive' | 'caution' | 'risk'
}

export interface RoleCompanyIntel {
  walking_into:        IntelSignal[]
  business_context:    IntelSignal[]
  what_this_means:     IntelSignal[]
  interview_narrative: string
}

export interface SearchConfig {
  id:                string
  user_id:           string
  name:              string | null
  keywords:          string[]
  target_companies:  string[]
  locations:         string[]
  sources:           SearchSourceName[]
  /** Tenant names (keys in KNOWN_WORKDAY) that are toggled OFF for this config. */
  workday_disabled:  string[]
  schedule_interval: ScheduleInterval
  last_run_at:       string | null
  is_active:         boolean
  serp_enabled:      boolean
  serp_next_offset:  number
  serp_query:        string | null  // override for Google Jobs query (max ~5 words); falls back to keywords[0..3]
  created_at:        string
}

/** Shape of the `search_runs.progress` JSONB column used for SSE / polling fallback. */
export interface SearchRunProgress {
  stage?:    'scraping' | 'normalizing' | 'deduplicating' | 'fetching_descriptions' | 'storing' | 'complete'
  found?:    number
  enriched?: number
  unique?:   number
  scored?:   number
  message?:  string
}

export interface SearchRun {
  id:            string
  user_id:       string
  config_id:     string | null
  started_at:    string
  completed_at:  string | null
  jobs_found:    number
  jobs_new:      number
  jobs_enriched: number
  jobs_scored:   number
  status:        SearchRunStatus
  error_text:    string | null
  apify_run_ids: Record<string, string> | null
  progress:      SearchRunProgress | null
  search_configs?: { name: string | null }
}


// Re-export constants for backward compatibility
export { BADGE_DEFINITIONS, STATUS_LABELS, STATUS_COLORS } from './constants'
