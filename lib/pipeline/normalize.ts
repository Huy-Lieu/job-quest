// lib/pipeline/normalize.ts
// Maps raw Apify output from any source into a single canonical job schema

import type { JobMetadata, RawApifyJob } from '@/lib/types'

export interface NormalizedJob {
  canonical_title:  string
  company:          string
  location:         string
  country_code:     string   // ISO 3166-1 alpha-2 e.g. "US", "IL", "DE" — or "REMOTE" / "UNKNOWN"
  description:      string
  salary_min:       number | null
  salary_max:       number | null
  salary_currency:  string
  job_type:         string   // full_time | contract | part_time | internship
  employment_type:  string   // remote | hybrid | on-site
  posted_at:        string | null
  is_phd:           boolean
  raw_hash:         string   // populated by deduplication layer
  metadata:         JobMetadata
  source: {
    name:          string
    url:           string
    source_job_id: string | null
  }
}

/** Coerce any possibly-undefined/null/non-string value into a string (empty if missing). */
function s(v: unknown): string {
  return v == null ? '' : typeof v === 'string' ? v : String(v)
}

/** Pick the first non-empty string from a list of candidates. */
function firstStr(...candidates: unknown[]): string {
  for (const c of candidates) {
    const str = s(c)
    if (str) return str
  }
  return ''
}

export function normalizeJob(raw: RawApifyJob, sourceName: string): NormalizedJob {
  const title       = cleanTitle(firstStr(raw.title, raw.jobTitle, raw.name))
  const company     = cleanCompany(firstStr(raw.company, raw.companyName, raw.employer))
  const description = firstStr(raw.description, raw.markdown, raw.text)
  const url         = firstStr(raw.url, raw.jobUrl, raw.applyUrl, raw.link)
  const salaryRaw   = firstStr(raw.salary, raw.salaryRange, raw.salary_range, raw.compensation)

  // Try structured salary first; fall back to description parsing.
  let salary_min = parseSalaryMin(salaryRaw)
  let salary_max = parseSalaryMax(salaryRaw)
  if (salary_min == null) {
    const parsed = parseSalaryFromDescription(description)
    if (parsed) {
      salary_min = parsed.min
      salary_max = parsed.max ?? salary_max
    }
  }

  const location = firstStr(raw.location, raw.jobLocation, raw.city) || 'Unknown'

  return {
    canonical_title: title,
    company,
    location,
    country_code:    inferCountryCode(location),
    description,
    salary_min,
    salary_max,
    salary_currency: 'USD',
    job_type:        normalizeJobType(firstStr(raw.employmentType, raw.jobType)),
    employment_type: normalizeWorkMode(firstStr(raw.workplaceType, raw.remote)),
    posted_at:       parsePostedDate(firstStr(
      raw.postedAt, raw.datePosted, raw.date, raw.posted_on, raw.published_on,
      raw.postedTime, raw.pubDate, raw.listedAt, raw.postedOn, raw.releasedDate, raw.first_published, raw.updated_at
    )),
    is_phd:          detectPhD(title, description),
    raw_hash:        '',   // filled in by deduplicateJobs()
    metadata:        buildMetadata(title, description, raw),
    source: {
      name:          sourceName,
      url,
      source_job_id: extractSourceJobId(raw, sourceName, url),
    },
  }
}

/**
 * Convenience wrapper — normalizes an array of raw jobs from a single source.
 * Skips entries that produce an empty title + empty company (noise/empty rows).
 */
export function normalizeAll(raws: RawApifyJob[], sourceName: string): NormalizedJob[] {
  return raws
    .map(raw => normalizeJob(raw, sourceName))
    .filter(j => j.canonical_title || j.company)
}

// ── country code inference ────────────────────────────────────────────────────

/**
 * All 50 US state codes + DC + common territories.
 * Used to infer country_code = "US" from location strings that don't
 * include "United States" explicitly (e.g. "Santa Ana, CA", "Austin, TX").
 */
const US_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC','PR','GU','VI',
])

/**
 * Maps common country name variants → ISO 3166-1 alpha-2 codes.
 * Covers the countries most likely to appear in job location strings.
 */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  'united states': 'US', 'usa': 'US', 'u.s.': 'US', 'u.s.a.': 'US',
  'united kingdom': 'GB', 'uk': 'GB', 'england': 'GB', 'scotland': 'GB', 'wales': 'GB',
  'canada': 'CA',
  'australia': 'AU',
  'germany': 'DE', 'deutschland': 'DE',
  'france': 'FR',
  'netherlands': 'NL', 'holland': 'NL',
  'sweden': 'SE',
  'norway': 'NO',
  'denmark': 'DK',
  'finland': 'FI',
  'switzerland': 'CH',
  'austria': 'AT',
  'belgium': 'BE',
  'spain': 'ES',
  'portugal': 'PT',
  'italy': 'IT',
  'poland': 'PL',
  'czech republic': 'CZ', 'czechia': 'CZ',
  'israel': 'IL',
  'india': 'IN',
  'japan': 'JP',
  'south korea': 'KR', 'korea': 'KR',
  'china': 'CN',
  'singapore': 'SG',
  'hong kong': 'HK',
  'taiwan': 'TW',
  'brazil': 'BR',
  'mexico': 'MX',
  'vietnam': 'VN', 'viet nam': 'VN',
  'united arab emirates': 'AE', 'uae': 'AE',
  'south africa': 'ZA',
}

/**
 * Infer an ISO 3166-1 alpha-2 country code from a free-text location string.
 *
 * Resolution order:
 *   1. "Remote" variants                → "REMOTE"
 *   2. "Multiple Locations"             → "MULTI"
 *   3. Explicit ISO-2 code in string    → that code
 *   4. Known country name substring     → mapped code
 *   5. US state code pattern (", CA")   → "US"
 *   6. Fallback                         → "UNKNOWN"
 */
export function inferCountryCode(location: string): string {
  if (!location || location.trim() === '') return 'UNKNOWN'

  const loc = location.toLowerCase().trim()

  // Remote
  if (/^remote$/.test(loc) || loc.includes('remote')) return 'REMOTE'

  // Multiple locations
  if (/^\d+\s+locations?$/.test(loc) || loc === 'multiple locations') return 'MULTI'

  // Explicit ISO-2 at end of string: "New York, NY, US" or "Austin, TX, USA"
  const isoSuffix = loc.match(/,\s*(usa?|[a-z]{2})\s*$/)
  if (isoSuffix) {
    const code = isoSuffix[1].toUpperCase().replace('USA', 'US')
    if (code === 'US' || US_STATE_CODES.has(code) === false) {
      // Only trust 2-letter codes that aren't US state codes
      if (!US_STATE_CODES.has(code)) return code
    }
    if (code === 'US') return 'US'
  }

  // Known country name anywhere in the string
  for (const [name, code] of Object.entries(COUNTRY_NAME_TO_CODE)) {
    if (loc.includes(name)) return code
  }

  // US state code pattern: ", CA" or ", TX" etc.
  const stateMatch = loc.match(/,\s*([a-z]{2})\b/)
  if (stateMatch && US_STATE_CODES.has(stateMatch[1].toUpperCase())) return 'US'

  return 'UNKNOWN'
}

// ── helpers ──────────────────────────────────────────────────────────────────

function cleanTitle(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\(.*?remote.*?\)/gi, '')
    .replace(/\[.*?\]/g, '')
    .trim()
}

function cleanCompany(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

function detectPhD(title: string, description: string): boolean {
  const text = `${title} ${description}`.toLowerCase()
  return /\bphd\b|\bdoctoral\b|\bpostdoc\b|\bfellowship\b|\bfunded position\b|\bdissertation\b/.test(text)
}

/**
 * Extract a stable source-specific job ID.
 * Priority order:
 *   1. Explicit source_job_id field (set by ATS scrapers in sources.ts)
 *   2. Source-specific named fields (jobId for LinkedIn, jobKey for Indeed, etc.)
 *   3. URL regex fallback keyed by sourceName
 */
function extractSourceJobId(raw: RawApifyJob, source: string, url: string): string | null {
  // Explicit field wins — ATS scrapers in sources.ts set this directly
  if (raw.source_job_id) return s(raw.source_job_id)

  // Source-specific named fields (actor output shapes vary by scraper)
  switch (source) {
    case 'linkedin': {
      // curious_coder/linkedin-jobs-scraper exposes jobId as a top-level field
      const jobId = raw['jobId'] ?? raw['id']
      if (jobId) return s(jobId)
      break
    }
    case 'indeed': {
      // misceres/indeed-scraper exposes jobKey
      const jobKey = raw['jobKey'] ?? raw['id']
      if (jobKey) return s(jobKey)
      break
    }
    case 'greenhouse':
    case 'lever':
    case 'ashby': {
      // ATS pages: requisitionId or id field from board JSON
      const reqId = raw['requisitionId'] ?? raw['id']
      if (reqId) return s(reqId)
      break
    }
  }

  // URL regex fallback
  return extractJobIdFromUrl(url, source)
}

function extractJobIdFromUrl(url: string, source: string): string | null {
  if (!url) return null
  if (source === 'linkedin')        return url.match(/\/view\/.*?-(\d+)/)?.[1]          ?? null
  if (source === 'greenhouse')      return url.match(/\/jobs\/(\d+)/)?.[1]              ?? null
  if (source === 'lever')           return url.match(/\/([0-9a-f-]{20,})/i)?.[1]        ?? null
  if (source === 'ashby')           return url.match(/\/([0-9a-f-]{20,})/i)?.[1]        ?? null
  if (source === 'indeed')          return url.match(/jk=([a-f0-9]+)/)?.[1]             ?? null
  if (source === 'glassdoor')       return url.match(/jobListingId=(\d+)/)?.[1]         ?? null
  if (source === 'ziprecruiter')    return url.match(/lvk=([A-Za-z0-9_-]+)/)?.[1]       ?? null
  if (source === 'wellfound')       return url.match(/\/(?:jobs|role)\/(\d+)/)?.[1]     ?? null
  if (source === 'workday')         return url.match(/\/job\/[^/]+\/([^/?#]+)/)?.[1]    ?? null
  if (source === 'smartrecruiters') return url.match(/\/([A-Za-z0-9-]{10,})$/)?.[1]     ?? null
  if (source === 'clearancejobs')   return url.match(/\/jobs\/(\d+)/)?.[1]              ?? null
  if (source === 'hn_hiring')       return url.match(/item\?id=(\d+)/)?.[1]             ?? null
  if (source === 'yc_waas')         return url.match(/\/jobs\/(\d+)/)?.[1]              ?? null
  if (source === 'workable')        return url.match(/\/j\/([A-F0-9]+)/i)?.[1]          ?? null
  if (source === 'recruitee')       return url.match(/\/o\/([^/?#]+)/)?.[1]             ?? null
  if (source === 'teamtailor')      return url.match(/\/jobs\/(\d+)/)?.[1]              ?? null
  if (source === 'personio')        return url.match(/\/job\/(\d+)/)?.[1]               ?? null
  return null
}

function parseSalaryMin(raw: string): number | null {
  if (!raw) return null
  const match = raw.match(/\$?([\d,]+)/)
  return match ? parseInt(match[1].replace(/,/g, ''), 10) : null
}

function parseSalaryMax(raw: string): number | null {
  if (!raw) return null
  const match = raw.match(/\$?([\d,]+)[^\d$]*\$?([\d,]+)/)
  return match ? parseInt(match[2].replace(/,/g, ''), 10) : parseSalaryMin(raw)
}

function normalizeJobType(raw: string): string {
  // DB enum `job_type_enum` uses underscores: 'full_time', 'part_time', etc.
  // Emitting hyphenated values ('full-time') crashes the jobs insert.
  const t = raw.toLowerCase()
  if (t.includes('contract'))    return 'contract'
  if (t.includes('part'))        return 'part_time'
  if (t.includes('intern'))      return 'internship'
  return 'full_time'
}

function normalizeWorkMode(raw: string): string {
  const t = (typeof raw === 'string' ? raw : '').toLowerCase()
  if (t.includes('remote'))  return 'remote'
  if (t.includes('hybrid'))  return 'hybrid'
  if (t.includes('on-site') || t.includes('onsite')) return 'on-site'
  return 'unknown'
}

function parsePostedDate(raw: string): string | null {
  if (!raw) return null
  try {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d.toISOString()
  } catch {
    return null
  }
}

// ── metadata ──────────────────────────────────────────────────────────────────
// Note: seniority, visa_sponsorship, skills_mentioned, and benefits are now
// extracted by the Claude Haiku enrichment pass (lib/claude/enricher.ts) and
// stored as first-class columns on the jobs table. Only applicant_count (from
// LinkedIn API metadata) and years_required (used as a cheap pre-enrichment
// heuristic for dedup) are retained here.

function buildMetadata(
  _title: string,
  description: string,
  raw: RawApifyJob
): JobMetadata {
  const years_required = parseYearsRequired(description)

  // LinkedIn exposes applicants_count; map it through when present
  const rawApplicants = raw.applicants_count ?? raw.applicantsCount ?? raw.numApplicants
  const applicant_count =
    typeof rawApplicants === 'number' ? rawApplicants :
    typeof rawApplicants === 'string' ? parseInt(rawApplicants, 10) || null :
    null

  const meta: JobMetadata = {}
  if (years_required != null) meta.years_required   = years_required
  if (applicant_count != null) meta.applicant_count = applicant_count
  return meta
}

function parseYearsRequired(description: string): number | null {
  if (!description) return null
  // Match common patterns:
  //   "5+ years of experience", "3-5 yrs", "at least 3 years",
  //   "minimum of 5 years", "requires 3+ years"
  const patterns = [
    /\b(?:at\s+least|minimum\s+of|requires?|min\.?)\s+(\d{1,2})\+?\s*(?:years?|yrs?)\b/i,
    /\b(\d{1,2})\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp\.?)\b/i,
    /\b(\d{1,2})\+?\s*(?:years?|yrs?)\b/i,
  ]
  for (const rx of patterns) {
    const m = description.match(rx)
    if (m) return parseInt(m[1], 10)
  }
  return null
}

/**
 * Pull salary numbers out of free-form description text. Handles:
 *   "$150,000 - $200,000"   "$150k-$200k"   "$150K-$200K"   "USD 120,000-180,000"
 *   "salary range $100k to $140k"    "$95/hr"
 * Returns the min (and optional max) in dollars, or null.
 */
function parseSalaryFromDescription(description: string): { min: number; max: number | null } | null {
  if (!description) return null
  const text = description.replace(/\u00a0/g, ' ')

  // Pattern 1: $X - $Y (with optional k)
  const rangeK = text.match(/\$\s*(\d{2,3}(?:,\d{3})?)\s*([kK])?\s*(?:-|to)\s*\$?\s*(\d{2,3}(?:,\d{3})?)\s*([kK])?/)
  if (rangeK) {
    const min = toDollars(rangeK[1], rangeK[2])
    const max = toDollars(rangeK[3], rangeK[4])
    if (min != null && max != null && max >= min && min >= 20_000) return { min, max }
  }

  // Pattern 2: single "$Xk" or "$X,XXX"
  const single = text.match(/\$\s*(\d{2,3}(?:,\d{3})?)\s*([kK])?\b/)
  if (single) {
    const v = toDollars(single[1], single[2])
    if (v != null && v >= 20_000) return { min: v, max: null }
  }

  return null
}

function toDollars(numStr: string, kSuffix?: string): number | null {
  const n = parseInt(numStr.replace(/,/g, ''), 10)
  if (isNaN(n)) return null
  if (kSuffix) return n * 1000
  // Heuristic: a 2-digit number with no 'k' suffix is probably hourly/nonsense
  return n < 1000 ? n * 1000 : n
}
