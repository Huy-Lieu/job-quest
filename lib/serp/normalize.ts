// lib/serp/normalize.ts
// Maps a raw SerpAPI google_jobs result to the canonical NormalizedJob schema

import type { SerpJobResult } from '@/lib/types'
import type { NormalizedJob } from '@/lib/pipeline/normalize'

const HOURS_PER_YEAR = 2080 // 40 hrs/week × 52 weeks

/**
 * Convert a relative date string returned by SerpAPI's detected_extensions.posted_at
 * (e.g. "3 days ago", "1 week ago", "2 months ago") to an ISO timestamp string.
 * Returns null when the string is unrecognizable.
 */
export function parseSerpDate(raw: string | undefined | null): string | null {
  if (!raw) return null

  const lower = raw.toLowerCase().trim()
  const now   = Date.now()

  // "just now", "today", "less than a day ago"
  if (/just now|today|less than/.test(lower)) {
    return new Date(now).toISOString()
  }

  // "X minute(s) ago"
  const minutes = lower.match(/(\d+)\s*minute/)
  if (minutes) return new Date(now - parseInt(minutes[1], 10) * 60_000).toISOString()

  // "X hour(s) ago"
  const hours = lower.match(/(\d+)\s*hour/)
  if (hours) return new Date(now - parseInt(hours[1], 10) * 3_600_000).toISOString()

  // "X day(s) ago"
  const days = lower.match(/(\d+)\s*day/)
  if (days) return new Date(now - parseInt(days[1], 10) * 86_400_000).toISOString()

  // "X week(s) ago"
  const weeks = lower.match(/(\d+)\s*week/)
  if (weeks) return new Date(now - parseInt(weeks[1], 10) * 7 * 86_400_000).toISOString()

  // "X month(s) ago"
  const months = lower.match(/(\d+)\s*month/)
  if (months) {
    const d = new Date(now)
    d.setMonth(d.getMonth() - parseInt(months[1], 10))
    return d.toISOString()
  }

  // "X year(s) ago"
  const years = lower.match(/(\d+)\s*year/)
  if (years) {
    const d = new Date(now)
    d.setFullYear(d.getFullYear() - parseInt(years[1], 10))
    return d.toISOString()
  }

  // Try parsing as an absolute date string as a last resort
  try {
    const d = new Date(raw)
    if (!isNaN(d.getTime())) return d.toISOString()
  } catch {
    // fall through
  }

  return null
}

/**
 * Parse the lower bound of a free-text salary string.
 * Handles:
 *   "$120,000 – $150,000 a year"   "$45 an hour"   "$120K–$160K"
 *   "USD 100,000 - 140,000"        "$80/hr"
 * Hourly rates are annualised at 2080 hours/year.
 * Returns null when no salary is parseable.
 */
export function parseSalaryMin(raw: string | undefined | null): number | null {
  if (!raw) return null
  const { min } = parseSalaryBounds(raw)
  return min
}

/**
 * Parse the upper bound of a free-text salary string.
 * Same format support as parseSalaryMin. Returns null for single-value strings.
 */
export function parseSalaryMax(raw: string | undefined | null): number | null {
  if (!raw) return null
  const { max } = parseSalaryBounds(raw)
  return max
}

// ── internal helpers ──────────────────────────────────────────────────────────

interface SalaryBounds {
  min: number | null
  max: number | null
}

function parseSalaryBounds(raw: string): SalaryBounds {
  // Normalise non-breaking spaces, en-dashes, em-dashes
  const text = raw.replace(/\u00a0/g, ' ').replace(/[–—]/g, '-')
  const isHourly = /\b(hour|hr)\b/i.test(text)

  // Try range first: $X[K] [- /to] $Y[K]
  const rangeMatch = text.match(
    /\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*([kK])?\s*(?:-|\/|to)\s*\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*([kK])?/
  )
  if (rangeMatch) {
    const min = toAnnual(parseFloat(rangeMatch[1].replace(/,/g, '')), rangeMatch[2], isHourly)
    const max = toAnnual(parseFloat(rangeMatch[3].replace(/,/g, '')), rangeMatch[4], isHourly)
    if (min != null && max != null && max >= min && min > 0) return { min, max }
    if (min != null && min > 0) return { min, max: null }
  }

  // Fall back to single value: $X[K]
  const singleMatch = text.match(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*([kK])?/)
  if (singleMatch) {
    const val = toAnnual(parseFloat(singleMatch[1].replace(/,/g, '')), singleMatch[2], isHourly)
    if (val != null && val > 0) return { min: val, max: null }
  }

  return { min: null, max: null }
}

/**
 * Convert a parsed numeric salary value to an annual integer.
 * @param n        - Raw numeric value
 * @param kSuffix  - Truthy if the original string had a "k" or "K" suffix
 * @param isHourly - True if the salary string contained "hour" or "hr"
 */
function toAnnual(n: number, kSuffix: string | undefined, isHourly: boolean): number | null {
  if (isNaN(n) || n <= 0) return null
  let annual = kSuffix ? n * 1_000 : n
  if (isHourly) annual = annual * HOURS_PER_YEAR
  // Sanity guard: ignore suspiciously small numbers (e.g. lone "2" matches)
  return annual >= 10_000 ? Math.round(annual) : null
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * Map a raw SerpAPI google_jobs result to the canonical NormalizedJob shape.
 * The returned raw_hash is intentionally empty — it is populated by the
 * deduplication layer (lib/pipeline/deduplicate.ts) before DB insertion.
 */
export function normalizeSerpJob(raw: SerpJobResult): NormalizedJob {
  const ext = raw.detected_extensions ?? {}

  // Prefer a direct apply link from related_links; fall back to share_link
  const url = raw.related_links?.find(l => /apply|job/i.test(l.text))?.link
            ?? raw.related_links?.[0]?.link
            ?? raw.share_link
            ?? ''

  const salaryStr = ext.salary ?? ''

  return {
    canonical_title: raw.title.trim(),
    company:         raw.company_name.trim(),
    location:        raw.location ?? '',
    description:     raw.description ?? '',
    salary_min:      parseSalaryMin(salaryStr),
    salary_max:      parseSalaryMax(salaryStr),
    salary_currency: 'USD',
    job_type:        normalizeJobType(ext.schedule_type ?? ''),
    employment_type: ext.work_from_home ? 'remote' : 'unknown',
    posted_at:       parseSerpDate(ext.posted_at),
    is_phd:          detectPhD(raw.title, raw.description),
    raw_hash:        '',   // filled in by deduplicateJobs()
    metadata:        {},
    source: {
      name:          'serp',
      url,
      source_job_id: raw.job_id ?? null,
    },
  }
}

// ── private normalizers ───────────────────────────────────────────────────────

function normalizeJobType(raw: string): string {
  const t = raw.toLowerCase()
  if (t.includes('contract'))  return 'contract'
  if (t.includes('part'))      return 'part_time'
  if (t.includes('intern'))    return 'internship'
  return 'full_time'
}

function detectPhD(title = '', description = ''): boolean {
  const text = `${title} ${description}`.toLowerCase()
  return /\bphd\b|\bdoctoral\b|\bpostdoc\b|\bfellowship\b|\bfunded position\b|\bdissertation\b/.test(text)
}
