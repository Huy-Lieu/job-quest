// lib/pipeline/normalize.ts
// Maps raw Apify output from any source into a single canonical job schema

import type { JobMetadata, RawApifyJob } from '@/lib/types'

export interface NormalizedJob {
  canonical_title:      string
  company:              string
  location:             string
  country_code:         string   // ISO 3166-1 alpha-2 e.g. "US", "IL", "DE" — or "REMOTE" / "UNKNOWN"
  description:          string
  salary_min:           number | null
  salary_max:           number | null
  salary_currency:      string
  job_type:             string   // full_time | contract | part_time | internship
  employment_type:      string   // remote | hybrid | on-site
  posted_at:            string | null
  is_phd:               boolean
  raw_hash:             string   // populated by deduplication layer
  metadata:             JobMetadata
  // ── free extractors (no Claude) ──────────────────────────────────────────
  visa_sponsorship:     'yes' | 'no' | 'unknown'
  security_clearance:   'none' | 'preferred' | 'required'
  work_mode:            'remote' | 'hybrid' | 'on-site' | null   // overrides scraped employment_type when detected
  experience_years_min: number | null
  experience_years_max: number | null
  tech_stack:           string[]
  benefits_highlights:  string[]
  application_deadline: string | null   // ISO date extracted from JD text (e.g. "2026-05-03")
  salary_levels:        Array<{ level: string; min: number; max: number }> | null  // per-level bands (e.g. NVIDIA L5/L6)
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
  const description = cleanDescription(firstStr(raw.description, raw.markdown, raw.text))
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

  // Infer country from location string; if that yields MULTI (Workday "Multiple Locations"),
  // attempt a secondary extraction from the source URL, which often embeds the real country
  // (e.g. /job/Israel-Tel-Aviv/..., /job/Mexico-Remote/..., /job/US-CA-Santa-Clara/...).
  let country_code = inferCountryCode(location)
  if (country_code === 'MULTI') {
    const urlCountry = inferCountryFromUrl(firstStr(raw.url, raw.jobUrl, raw.applyUrl, raw.link))
    if (urlCountry) country_code = urlCountry
  }

  // ── Free extractors — all run on the cleaned description, zero cost ─────────
  const scrapedWorkMode = normalizeWorkMode(firstStr(raw.workplaceType, raw.remote))
  const detectedWorkMode = extractWorkMode(description)

  return {
    canonical_title:      title,
    company,
    location,
    country_code,
    description,
    salary_min,
    salary_max,
    salary_currency:      'USD',
    job_type:             normalizeJobType(firstStr(raw.employmentType, raw.jobType)),
    employment_type:      detectedWorkMode ?? scrapedWorkMode,
    posted_at:            parsePostedDate(firstStr(
      raw.postedAt, raw.datePosted, raw.date, raw.posted_on, raw.published_on,
      raw.postedTime, raw.pubDate, raw.listedAt, raw.postedOn, raw.releasedDate, raw.first_published, raw.updated_at
    )),
    is_phd:               detectPhD(title, description),
    raw_hash:             '',   // filled in by deduplicateJobs()
    metadata:             buildMetadata(title, description, raw),
    visa_sponsorship:     extractVisa(description),
    security_clearance:   extractClearance(title, description),
    work_mode:            detectedWorkMode,
    experience_years_min: extractExpMin(description),
    experience_years_max: extractExpMax(description),
    tech_stack:           extractTechStack(description),
    benefits_highlights:  extractBenefits(description),
    application_deadline: extractDeadline(description),
    salary_levels:        extractSalaryLevels(description),
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
 *   1. "Remote" (standalone only — "Remote, Germany" falls through to country check) → "REMOTE"
 *   2. "Multiple Locations"             → "MULTI"
 *   3. Explicit ISO-2 code in string    → that code
 *   4. Known country name substring     → mapped code
 *   5. US state code pattern (", CA")   → "US"
 *   6. Fallback                         → "UNKNOWN"
 */
export function inferCountryCode(location: string): string {
  if (!location || location.trim() === '') return 'UNKNOWN'

  const loc = location.toLowerCase().trim()

  // Remote — only return REMOTE if "remote" is the entire string or the primary
  // location with no country context. Compound strings like "Remote, Germany"
  // should fall through to the country-name check so the country code wins.
  if (/^remote$/.test(loc)) return 'REMOTE'
  if (/^remote\s+(only|work|jobs?)$/.test(loc)) return 'REMOTE'
  if (/^(fully |100%\s*)remote$/.test(loc)) return 'REMOTE'

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

/**
 * Secondary country detection for Workday-style URLs where the location string
 * was "Multiple Locations" → MULTI. Workday embeds country/city in the path:
 *   .../job/Israel-Tel-Aviv/...          → IL
 *   .../job/Mexico-Remote/...            → MX
 *   .../job/US-CA-Santa-Clara/...        → US
 *   .../job/Germany-Munich/...           → DE
 *   .../job/United-Kingdom-London/...    → GB
 *   .../job/Canada-Ontario-Toronto/...   → CA
 *
 * Returns the ISO code if recognized, or null (keep MULTI / let filter decide).
 */
function inferCountryFromUrl(url: string): string | null {
  if (!url) return null

  // Extract the segment after /job/ before the next slash
  const segment = url.match(/\/job\/([^/?#]+)/)?.[1]
  if (!segment) return null

  const seg = segment.toLowerCase().replace(/-/g, ' ')

  // Check for US state codes: "US CA Santa Clara", "US TX Austin"
  if (/^us\b/.test(seg)) return 'US'

  // Map known country prefixes (Workday uses full English country name at start)
  const urlCountryPrefixes: Array<[RegExp, string]> = [
    [/^israel\b/,          'IL'],
    [/^mexico\b/,          'MX'],
    [/^canada\b/,          'CA'],
    [/^united kingdom\b/,  'GB'],
    [/^germany\b/,         'DE'],
    [/^france\b/,          'FR'],
    [/^netherlands\b/,     'NL'],
    [/^sweden\b/,          'SE'],
    [/^norway\b/,          'NO'],
    [/^denmark\b/,         'DK'],
    [/^finland\b/,         'FI'],
    [/^switzerland\b/,     'CH'],
    [/^austria\b/,         'AT'],
    [/^belgium\b/,         'BE'],
    [/^spain\b/,           'ES'],
    [/^portugal\b/,        'PT'],
    [/^italy\b/,           'IT'],
    [/^poland\b/,          'PL'],
    [/^india\b/,           'IN'],
    [/^japan\b/,           'JP'],
    [/^south korea\b/,     'KR'],
    [/^china\b/,           'CN'],
    [/^singapore\b/,       'SG'],
    [/^australia\b/,       'AU'],
    [/^brazil\b/,          'BR'],
    [/^taiwan\b/,          'TW'],
    [/^hong kong\b/,       'HK'],
    [/^united arab emirates\b/, 'AE'],
    [/^south africa\b/,    'ZA'],
  ]

  for (const [rx, code] of urlCountryPrefixes) {
    if (rx.test(seg)) return code
  }

  return null
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

// ── Free extractors ──────────────────────────────────────────────────────────
// All run on the cleaned description text. Zero cost — no Claude calls.

/**
 * Detect visa sponsorship signal from job description.
 * Returns 'yes' | 'no' | 'unknown'.
 */
export function extractVisa(text: string): 'yes' | 'no' | 'unknown' {
  const t = text.toLowerCase()
  if (
    /does not (offer|provide|support) (visa )?sponsor|sponsorship (is )?(not available|not provided|unavailable)|must be (authorized|eligible|permitted) to work|no (visa )?sponsorship|cannot sponsor|not able to sponsor|work authorization required|us citizens? (only|required)|u\.s\. citizens?hip required|sponsorship not available/.test(t)
  ) return 'no'
  if (
    /(will|can|able to|does) (offer|provide|support) (visa )?sponsor|h-?1b (sponsor|transfer)|visa sponsorship (is )?(available|provided|offered)|we (will )?sponsor|sponsorship (is )?available|open to sponsoring/.test(t)
  ) return 'yes'
  return 'unknown'
}

/**
 * Detect security clearance requirement from title + description.
 * Returns 'required' | 'preferred' | 'none'.
 */
export function extractClearance(title: string, text: string): 'required' | 'preferred' | 'none' {
  const t = `${title} ${text}`.toLowerCase()
  if (
    /ts\/sci|top secret\/sci|active (secret|ts) clearance|clearance required|must hold.*clearance|must have.*clearance|clearance (is )?required|dod secret|dod clearance|secret clearance required|sensitive compartmented/.test(t)
  ) return 'required'
  if (
    /clearance preferred|clearance (is a )?plus|clearance (is )?desired|secret preferred|ability to obtain.*clearance|eligible for.*clearance/.test(t)
  ) return 'preferred'
  return 'none'
}

/**
 * Detect work mode from description text.
 * Returns 'remote' | 'hybrid' | 'on-site' | null (null = no signal, keep scraped value).
 */
export function extractWorkMode(text: string): 'remote' | 'hybrid' | 'on-site' | null {
  const t = text.toLowerCase()
  if (/fully remote|100% remote|remote.first|remote first|work from anywhere|work from home\b|wfh\b/.test(t)) return 'remote'
  if (
    /hybrid.*(\d\s*day|\d\+?\s*day|few day|some day)|(\d\s*day|\d\+?\s*day) (in.?office|on.?site|in office)|remote.?hybrid|hybrid.?remote|flexible.*office|days? (in|on).?site per week/.test(t)
  ) return 'hybrid'
  if (
    /\bon.?site\b|\bin.?office\b|in.person\b|must be (located|based|present)|relocation required|office.?based\b|required to be on.?site/.test(t)
  ) return 'on-site'
  return null
}

/**
 * Extract minimum years of experience from description.
 * Handles "5+ years", "at least 3 years", "3-7 years" (takes the lower bound).
 */
export function extractExpMin(text: string): number | null {
  // Range first: "3-7 years", "3 to 7 years"
  const range = text.match(/\b(\d{1,2})\+?\s*(?:[-–]|to)\s*\d{1,2}\+?\s*(?:years?|yrs?)\b/i)
  if (range) return parseInt(range[1], 10)
  // Qualified minimum: "at least 5 years", "minimum 3 years", "requires 7+ years"
  const qualified = text.match(
    /\b(?:at\s+least|minimum\s+of?|min\.?|requires?)\s+(\d{1,2})\+?\s*(?:years?|yrs?)\b/i
  )
  if (qualified) return parseInt(qualified[1], 10)
  // Plain "5+ years [of experience]"
  const plain = text.match(/\b(\d{1,2})\+\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp\.?)?\b/i)
  if (plain) return parseInt(plain[1], 10)
  return null
}

/**
 * Extract maximum years of experience from description.
 * Only populated for explicit ranges like "3-7 years". Returns null otherwise.
 */
export function extractExpMax(text: string): number | null {
  const range = text.match(/\b\d{1,2}\+?\s*(?:[-–]|to)\s*(\d{1,2})\+?\s*(?:years?|yrs?)\b/i)
  return range ? parseInt(range[1], 10) : null
}

/**
 * Extract tech stack keywords from description.
 * Uses a curated keyword list covering languages, frameworks, infra, EDA tools, and protocols.
 * Returns matched keywords in lower-case, deduplicated.
 */
const TECH_KEYWORDS: string[] = [
  // Languages
  'python', 'javascript', 'typescript', 'java', 'c++', 'c#', 'golang', 'go', 'rust',
  'swift', 'kotlin', 'ruby', 'scala', 'r', 'matlab', 'bash', 'powershell',
  // HDL
  'verilog', 'vhdl', 'systemverilog', 'uvm', 'rtl',
  // Frameworks / libs
  'react', 'next.js', 'vue', 'angular', 'django', 'flask', 'fastapi', 'spring',
  'node.js', '.net', 'pytorch', 'tensorflow', 'keras', 'scikit-learn', 'pandas', 'numpy',
  // Cloud / infra
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ansible',
  'jenkins', 'github actions', 'ci/cd', 'gitlab', 'argocd', 'helm',
  // Databases
  'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'snowflake',
  'bigquery', 'sqlite', 'dynamodb', 'cassandra',
  // EDA / FPGA tools
  'fpga', 'xilinx', 'intel fpga', 'altera', 'vivado', 'quartus', 'cadence',
  'synopsys', 'mentor', 'vcs', 'questa', 'xcelium', 'spice', 'hspice',
  'virtuoso', 'innovus', 'genus', 'primetime', 'calibre',
  // Protocols / buses
  'can bus', 'lin', 'spi', 'i2c', 'uart', 'pcie', 'usb', 'ethernet',
  'axi', 'ahb', 'apb', 'jtag', 'ble', 'bluetooth', 'wifi', '5g', 'lte',
  // Other tools
  'git', 'linux', 'jira', 'confluence', 'figma', 'tableau', 'powerbi', 'airflow',
]

export function extractTechStack(text: string): string[] {
  const t = text.toLowerCase()
  const seen = new Set<string>()
  for (const kw of TECH_KEYWORDS) {
    const escaped = kw.replace(/[.+]/g, '\\$&')
    if (new RegExp(`\\b${escaped}\\b`).test(t) && !seen.has(kw)) {
      seen.add(kw)
    }
  }
  return [...seen]
}

/**
 * Extract benefits highlights from description text.
 * Checks for explicit benefit signals and returns a deduplicated label list.
 * "Unlimited PTO" takes priority over generic "PTO" to avoid double-tagging.
 */
const BENEFIT_RULES: Array<[RegExp, string]> = [
  [/\b401k\b|\b401\(k\)/i,                                         '401k'],
  [/equity|rsu\b|stock options?|esop\b/i,                          'Equity/RSUs'],
  [/signing bonus|sign-?on bonus/i,                                'Signing bonus'],
  [/unlimited pto|open pto|flexible pto|unlimited vacation/i,      'Unlimited PTO'],
  [/\bpto\b|paid time off|\bvacation days?\b/i,                    'PTO'],
  [/health insurance|medical.*dental|dental.*vision|healthcare/i,  'Health insurance'],
  [/parental leave|maternity|paternity/i,                          'Parental leave'],
  [/relocation( assistance)?/i,                                    'Relocation'],
  [/tuition|education reimbursement|learning.*budget/i,            'Education budget'],
  [/home office (stipend|allowance|budget)|office stipend/i,       'Home office stipend'],
  [/gym|wellness (benefit|program|stipend)|fitness/i,              'Wellness benefit'],
  [/catered (lunch|meal)|free (lunch|food|meals)/i,                'Free meals'],
]

export function extractBenefits(text: string): string[] {
  const results: string[] = []
  let hasUnlimitedPTO = false
  for (const [rx, label] of BENEFIT_RULES) {
    if (rx.test(text)) {
      if (label === 'Unlimited PTO') hasUnlimitedPTO = true
      // Skip generic PTO if unlimited PTO already matched
      if (label === 'PTO' && hasUnlimitedPTO) continue
      results.push(label)
    }
  }
  return results
}

/**
 * Extract application deadline from description text.
 * Looks for explicit "applications accepted until / closing date / deadline" phrases.
 * Returns an ISO date string (YYYY-MM-DD) or null.
 */
export function extractDeadline(text: string): string | null {
  if (!text) return null

  // "Applications accepted at least until May 3, 2026" / "deadline: June 1, 2026"
  const MONTHS: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04',
    jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  }

  const pattern = /(?:applications?\s+(?:are\s+)?accepted\s+(?:at\s+least\s+)?until|closing\s+date[:\s]+|deadline[:\s]+|apply\s+by[:\s]+|application\s+deadline[:\s]+)\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i
  const m = text.match(pattern)
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()]
    if (mo) {
      const day = m[2].padStart(2, '0')
      return `${m[3]}-${mo}-${day}`
    }
  }

  // ISO date in deadline context: "deadline: 2026-05-03"
  const iso = text.match(/(?:deadline|closing\s+date|apply\s+by)[:\s]+(\d{4}-\d{2}-\d{2})/i)
  if (iso) return iso[1]

  return null
}

/**
 * Extract per-level salary bands for roles that post multiple compensation tiers
 * (e.g. NVIDIA L5/L6, Google L4/L5).
 * Returns null if only a single range is present (already stored in salary_min/max).
 *
 * Example match:
 *   "L5: $196,000 – $310,500 / L6: $232,000 – $368,000"
 *   "IC3 compensation range: $120k–$160k; IC4: $160k–$210k"
 */
export function extractSalaryLevels(text: string): Array<{ level: string; min: number; max: number }> | null {
  if (!text) return null

  // Pattern: Level label followed by a salary range
  const LEVEL_RANGE =
    /\b(L\d|IC\d|E\d|P\d|M\d|G\d{2}|Grade\s+\d+|Level\s+\d+|Senior|Staff|Principal)\b[^$\n]{0,40}\$\s*([\d,]+)\s*[kK]?\s*[-–—]\s*\$?\s*([\d,]+)\s*[kK]?/gi

  const levels: Array<{ level: string; min: number; max: number }> = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null

  while ((m = LEVEL_RANGE.exec(text)) !== null) {
    const label = m[1].trim()
    if (seen.has(label)) continue
    seen.add(label)

    const raw1 = parseInt(m[2].replace(/,/g, ''), 10)
    const raw2 = parseInt(m[3].replace(/,/g, ''), 10)
    const min = raw1 < 1000 ? raw1 * 1000 : raw1
    const max = raw2 < 1000 ? raw2 * 1000 : raw2
    if (min >= 20_000 && max >= min) levels.push({ level: label, min, max })
  }

  return levels.length >= 2 ? levels : null
}

// ── Section-header regex shared by cleanDescription ───────────────────────────
// When LinkedIn/Indeed collapse the JD into one paragraph, sentence endings
// followed by a known header keyword need a newline injected so the renderer
// can display them as section titles.
const SECTION_HEADER_RE =
  /^(what you[''']ll be doing|what we need to see|what we[''']re looking for|ways to stand out from the crowd|ways to stand out|about the role|about the team|about you|responsibilities|key responsibilities|requirements|qualifications|preferred qualifications|minimum qualifications|basic qualifications|additional qualifications|nice to have|bonus points|benefits|compensation|who you are|the role|your role|your impact|your background|your qualifications|what you will do|what you[''']ll do|what you bring|what you[''']ll bring|you will|you have|you are|we offer|we provide|the team|our team|what we offer|why join us|what makes this role exciting|location|the opportunity|who we are|your day to day|day to day|you[''']ll be responsible for|core responsibilities|about the company|about us|the position|job summary|job description|overview|the job|what you get|perks|your tasks|your duties|what does the job involve|what will you do|what will you be doing|ideal candidate|our ideal candidate|must have|should have|experience required|education|work environment|equal opportunity|eoe)[\s:]*$/i

/**
 * Normalise a raw job description to clean, readable plain text.
 *
 * Sources and what they return:
 *   LinkedIn   — HTML with <ul>/<li>/<strong>/<p>/<br> etc.
 *   Indeed     — HTML similar to LinkedIn
 *   Greenhouse — HTML from their job board JSON API
 *   Lever      — HTML
 *   SerpAPI    — plain text, often one collapsed paragraph
 *   Workday    — already-fetched markdown (enrichWorkdayDescriptions no longer runs)
 *   career_page — markdown from website-content-crawler
 *   rag-browser  — markdown
 *
 * Steps:
 *   1. Decode HTML entities (&amp; &nbsp; etc.)
 *   2. If HTML: convert structural tags → newlines/bullets, strip remaining tags
 *   3. Normalize unicode bullet characters (•·▪▸–) → "- "
 *   4. Re-inject newlines before section headers collapsed into one paragraph
 *   5. Split "Header: content" inline → "Header\ncontent"
 *   6. Collapse 3+ blank lines → 2, trim
 */
export function cleanDescription(raw: string): string {
  if (!raw) return ''

  // Step 1: Decode HTML entities
  let text = raw
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')

  // Step 2: HTML → plain text
  if (/<[a-z][\s\S]*>/i.test(text)) {
    text = text
      // block-level breaks → newlines
      .replace(/<br\s*\/?>/gi,        '\n')
      .replace(/<\/p>/gi,             '\n')
      .replace(/<\/div>/gi,           '\n')
      .replace(/<\/h[1-6]>/gi,        '\n')
      // list items → "- " bullets before stripping
      .replace(/<li[^>]*>/gi,         '\n- ')
      .replace(/<\/li>/gi,            '')
      .replace(/<\/ul>|<\/ol>/gi,     '\n')
      // inline bold → markdown bold
      .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
      .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi,           '**$1**')
      // strip all remaining tags
      .replace(/<[^>]+>/g, '')
  }

  // Step 3: Normalize unicode bullet characters to "- "
  // Use \*(?!\*) so we don't clobber markdown bold (**text**) that starts a line
  text = text.replace(/^[•·▪▸–—]\s*/gm, '- ')
  text = text.replace(/^\*(?!\*)\s*/gm, '- ')
  // Clean up double-bullets from sources that put • inside <li> (e.g. Lever)
  text = text.replace(/^(-\s+)[•·▪▸–—\*]\s*/gm, '$1')

  // Step 4: Re-inject newlines before section headers that were collapsed into
  // a single paragraph (e.g. "...experience required. Responsibilities Work on...")
  text = text.replace(
    /([.!?])\s+(What you[''']ll be doing|What we need to see|What we[''']re looking for|Ways to stand out from the crowd|Ways to stand out|About the role|About the team|About you|Responsibilities|Key responsibilities|Requirements|Qualifications|Preferred qualifications|Minimum qualifications|Basic qualifications|Additional qualifications|Nice to have|Bonus points|Benefits|Compensation|Who you are|The role|Your role|Your impact|Your background|Your qualifications|What you will do|What you[''']ll do|What you bring|What you[''']ll bring|You will|You have|You are|We offer|We provide|The team|Our team|What we offer|Why join us|What makes this role exciting|Location|The opportunity|Who we are|Your day to day|Day to day|You[''']ll be responsible for|Core responsibilities|About the company|About us|The position|Job summary|Overview|What you get|Perks|Your tasks|Your duties|Must have|Should have|Experience required|Education|Work environment|Equal opportunity)/gi,
    '$1\n\n$2'
  )

  // Step 5: Split "Header: content on same line" → "Header\ncontent"
  text = text.replace(
    new RegExp('^(' + SECTION_HEADER_RE.source.slice(1, -2) + '):\\s+', 'gim'),
    '$1\n'
  )

  // Step 6: Collapse 3+ blank lines → 2, normalize trailing whitespace, trim
  text = text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim()

  return text
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
      const jobId = raw['jobId'] ?? raw['id']
      if (jobId) return s(jobId)
      break
    }
    case 'indeed': {
      const jobKey = raw['jobKey'] ?? raw['id']
      if (jobKey) return s(jobKey)
      break
    }
    case 'greenhouse':
    case 'lever':
    case 'ashby': {
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

  const lower = raw.toLowerCase().trim()
  const now   = Date.now()

  if (/posted today|posted just now/.test(lower)) {
    return new Date(now).toISOString()
  }
  if (/posted yesterday/.test(lower)) {
    return new Date(now - 86_400_000).toISOString()
  }

  const wdDays = lower.match(/posted\s+(\d+)\+?\s+day/)
  if (wdDays) return new Date(now - parseInt(wdDays[1], 10) * 86_400_000).toISOString()

  const wdWeeks = lower.match(/posted\s+(\d+)\+?\s+week/)
  if (wdWeeks) return new Date(now - parseInt(wdWeeks[1], 10) * 7 * 86_400_000).toISOString()

  const wdMonths = lower.match(/posted\s+(\d+)\+?\s+month/)
  if (wdMonths) {
    const d = new Date(now)
    d.setMonth(d.getMonth() - parseInt(wdMonths[1], 10))
    return d.toISOString()
  }

  try {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d.toISOString()
  } catch {
    return null
  }
}

// ── metadata ──────────────────────────────────────────────────────────────────
// visa_sponsorship, security_clearance, work_mode, experience_years_min/max,
// tech_stack, and benefits_highlights are now extracted as first-class fields
// by the free extractors above. Only applicant_count (from LinkedIn metadata)
// is retained here as pipeline-time metadata.

function buildMetadata(
  _title: string,
  description: string,
  raw: RawApifyJob
): JobMetadata {
  const rawApplicants = raw.applicants_count ?? raw.applicantsCount ?? raw.numApplicants
  const applicant_count =
    typeof rawApplicants === 'number' ? rawApplicants :
    typeof rawApplicants === 'string' ? parseInt(rawApplicants, 10) || null :
    null

  const meta: JobMetadata = {}
  if (applicant_count != null) meta.applicant_count = applicant_count
  return meta
}

/**
 * Pull salary numbers out of free-form description text.
 */
function parseSalaryFromDescription(description: string): { min: number; max: number | null } | null {
  if (!description) return null
  const text = description.replace(/ /g, ' ')

  const rangeK = text.match(/\$\s*(\d{2,3}(?:,\d{3})?)\s*([kK])?\s*(?:-|to)\s*\$?\s*(\d{2,3}(?:,\d{3})?)\s*([kK])?/)
  if (rangeK) {
    const min = toDollars(rangeK[1], rangeK[2])
    const max = toDollars(rangeK[3], rangeK[4])
    if (min != null && max != null && max >= min && min >= 20_000) return { min, max }
  }

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
  return n < 1000 ? n * 1000 : n
}
