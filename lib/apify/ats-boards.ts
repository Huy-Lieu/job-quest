// lib/apify/ats-boards.ts
// ATS board JSON APIs — free, structured, no Apify credits consumed.
// Includes: Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee

// ─────────────────────────────────────────────────────────────────────────────
// Greenhouse — boards-api.greenhouse.io/v1/boards/<slug>/jobs
// ─────────────────────────────────────────────────────────────────────────────

interface GreenhouseJob {
  id:              number | string
  title?:          string
  absolute_url?:   string
  content?:        string
  updated_at?:     string
  first_published?: string
  location?:       { name?: string }
}

export async function fetchGreenhouseBoard(slug: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return []
    const body = await res.json()
    return ((body.jobs ?? []) as GreenhouseJob[]).map((j) => ({
      title:         j.title ?? '',
      company:       slug,
      location:      j.location?.name ?? 'Unknown',
      url:           j.absolute_url ?? '',
      description:   j.content ?? '',
      postedAt:      j.first_published ?? j.updated_at ?? null,
      source_job_id: String(j.id),
    }))
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lever — api.lever.co/v0/postings/<slug>?mode=json
// ─────────────────────────────────────────────────────────────────────────────

interface LeverJob {
  id:          string
  text?:       string
  hostedUrl?:  string
  description?: string
  descriptionPlain?: string
  workplaceType?: string
  createdAt?:  number
  categories?: { location?: string; commitment?: string; team?: string }
}

export async function fetchLeverBoard(slug: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(
      `https://api.lever.co/v0/postings/${slug}?mode=json`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return []
    const postings = await res.json()
    return ((postings ?? []) as LeverJob[]).map((p) => ({
      title:          p.text ?? '',
      company:        slug,
      location:       p.categories?.location ?? 'Unknown',
      url:            p.hostedUrl ?? '',
      description:    p.descriptionPlain ?? p.description ?? '',
      employmentType: p.categories?.commitment,
      workplaceType:  p.workplaceType,
      postedAt:       p.createdAt ? new Date(p.createdAt).toISOString() : null,
      source_job_id:  p.id,
    }))
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ashby — api.ashbyhq.com/posting-api/job-board/<slug>
// ─────────────────────────────────────────────────────────────────────────────

interface AshbyJob {
  id:                string
  title?:            string
  jobUrl?:           string
  location?:         string
  descriptionHtml?:  string
  descriptionPlain?: string
  employmentType?:   string
  isRemote?:         boolean
  publishedAt?:      string
}

export async function fetchAshbyBoard(slug: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(
      `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return []
    const body = await res.json()
    return ((body.jobs ?? []) as AshbyJob[]).map((j) => ({
      title:          j.title ?? '',
      company:        slug,
      location:       j.location ?? 'Unknown',
      url:            j.jobUrl ?? '',
      description:    j.descriptionHtml ?? j.descriptionPlain ?? '',
      employmentType: j.employmentType,
      workplaceType:  j.isRemote ? 'remote' : undefined,
      postedAt:       j.publishedAt ?? null,
      source_job_id:  j.id,
    }))
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Workday — POST JSON per {tenant, dc, site}
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkdayTenant {
  tenant: string   // e.g. 'qualcomm'
  dc:     string   // e.g. 'wd5'
  site:   string   // e.g. 'External'
}

interface WorkdayJob {
  title?:         string
  externalPath?:  string
  locationsText?: string
  postedOn?:      string
  bulletFields?:  string[]
}

// Maps Workday's ISO country code prefix → full country name.
// Workday returns locations as "CC, Region, City" e.g. "US, CA, Santa Clara".
const WORKDAY_COUNTRY_CODES: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  UK: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  DE: 'Germany',
  FR: 'France',
  NL: 'Netherlands',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
  FI: 'Finland',
  CH: 'Switzerland',
  AT: 'Austria',
  BE: 'Belgium',
  ES: 'Spain',
  PT: 'Portugal',
  IT: 'Italy',
  PL: 'Poland',
  CZ: 'Czech Republic',
  HU: 'Hungary',
  RO: 'Romania',
  IL: 'Israel',
  IN: 'India',
  JP: 'Japan',
  KR: 'South Korea',
  CN: 'China',
  SG: 'Singapore',
  HK: 'Hong Kong',
  TW: 'Taiwan',
  BR: 'Brazil',
  MX: 'Mexico',
  AR: 'Argentina',
  ZA: 'South Africa',
  AE: 'United Arab Emirates',
  VN: 'Vietnam',
}

/**
 * Normalise a Workday locationsText string into a human-readable format
 * compatible with the pipeline's generic location filter.
 *
 * Input formats observed from the Workday CXS API:
 *   "US, CA, Santa Clara"    → "Santa Clara, CA, United States"
 *   "Israel, Yokneam"        → "Yokneam, Israel"
 *   "Vietnam, Ho Chi Minh City" → "Ho Chi Minh City, Vietnam"
 *   "2 Locations"            → "Multiple Locations"
 *   ""  / undefined          → "Unknown"
 *
 * The output always ends with the full country name so that a filter checking
 * for "United States" or "Israel" works with a simple substring match.
 */
function normalizeWorkdayLocation(raw: string | undefined): string {
  if (!raw || raw.trim() === '') return 'Unknown'

  const trimmed = raw.trim()

  // "N Locations" — multi-location posting, keep as a passthrough sentinel
  if (/^\d+\s+locations?$/i.test(trimmed)) return 'Multiple Locations'

  const parts = trimmed.split(',').map(p => p.trim()).filter(Boolean)
  if (parts.length === 0) return 'Unknown'

  // First part is usually the country code (e.g. "US") or full country name
  const firstUpper = parts[0].toUpperCase()
  const country    = WORKDAY_COUNTRY_CODES[firstUpper]

  if (country) {
    // Known 2-letter ISO code — reorder to "City, State, Country"
    // parts: ["US", "CA", "Santa Clara"] → "Santa Clara, CA, United States"
    const rest = parts.slice(1).reverse()   // reverse so city comes first
    return [...rest, country].join(', ')
  }

  // No recognised code — treat first part as country name, rest as city
  // e.g. ["Israel", "Yokneam"] → "Yokneam, Israel"
  // e.g. ["Vietnam", "Ho Chi Minh City"] → "Ho Chi Minh City, Vietnam"
  const cityParts = parts.slice(1)
  if (cityParts.length > 0) {
    return [...cityParts, parts[0]].join(', ')
  }

  return trimmed
}

// ISO country code → Workday locationCountry facet value
const WORKDAY_LOCATION_FACET: Record<string, string> = {
  US: 'United States of America', GB: 'United Kingdom', CA: 'Canada',
  AU: 'Australia', DE: 'Germany', FR: 'France', NL: 'Netherlands',
  SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland',
  CH: 'Switzerland', AT: 'Austria', BE: 'Belgium', ES: 'Spain',
  PT: 'Portugal', IT: 'Italy', PL: 'Poland', IL: 'Israel',
  IN: 'India', JP: 'Japan', SG: 'Singapore', BR: 'Brazil', MX: 'Mexico',
}

export async function fetchWorkdayBoard(
  t: WorkdayTenant,
  query: string,
  limit = 20,
  locationCode?: string,
): Promise<Record<string, unknown>[]> {
  const label = `${t.tenant}/${t.site} (${t.dc})`
  try {
    const base = `https://${t.tenant}.${t.dc}.myworkdayjobs.com`
    const apiUrl = `${base}/wday/cxs/${t.tenant}/${t.site}/jobs`
    console.log(`[workday] → POST ${apiUrl} query="${query}" limit=${limit}`)
    const res = await fetch(
      apiUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ appliedFacets: locationCode && WORKDAY_LOCATION_FACET[locationCode.toUpperCase()] ? { locationCountry: [WORKDAY_LOCATION_FACET[locationCode.toUpperCase()]] } : {}, limit, offset: 0, searchText: query }),
      }
    )
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.warn(`[workday] ✗ ${label} — HTTP ${res.status} ${res.statusText} | body: ${errBody.slice(0, 300)}`)
      return []
    }
    console.log(`[workday] ✓ ${label} — HTTP ${res.status}`)
    const body = await res.json()
    const postings = (body.jobPostings ?? []) as WorkdayJob[]
    console.log(`[workday] ${label} — ${postings.length} posting(s) returned`)
    if (postings.length === 0) return []

    return postings.map(j => {
      // Build public apply URL: bare externalPath needs locale + site prefix
      let url = ''
      if (j.externalPath) {
        if (j.externalPath.startsWith('https://')) {
          if (!j.externalPath.includes('community.workday.com')) {
            url = j.externalPath
          }
        } else if (j.externalPath.startsWith('/')) {
          url = `${base}/en-US/${t.site}${j.externalPath}`
        }
      }

      return {
        title:         j.title ?? '',
        company:       t.tenant,
        location:      normalizeWorkdayLocation(j.locationsText),
        url,
        // Bullet fragments only — full description fetched post-filter via Apify RAG
        description:   (j.bulletFields ?? []).join('\n'),
        postedAt:      j.postedOn ?? null,
        source_job_id: j.externalPath ?? null,
      }
    })
  } catch (err) {
    console.error(`[workday] ✗ ${label} — exception: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SmartRecruiters — api.smartrecruiters.com/v1/companies/<slug>/postings
// ─────────────────────────────────────────────────────────────────────────────

interface SmartRecruitersJob {
  id?:       string
  name?:     string
  location?: { city?: string; country?: string }
  releasedDate?: string
  company?:  { name?: string }
}

export async function fetchSmartRecruitersBoard(slug: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(
      `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return []
    const body = await res.json()
    return ((body.content ?? []) as SmartRecruitersJob[]).map((j) => ({
      title:         j.name ?? '',
      company:       j.company?.name ?? slug,
      location:      [j.location?.city, j.location?.country].filter(Boolean).join(', ') || 'Unknown',
      url:           j.id ? `https://careers.smartrecruiters.com/${slug}/${j.id}` : '',
      description:   '',
      postedAt:      j.releasedDate ?? null,
      source_job_id: j.id ?? null,
    }))
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Workable — apply.workable.com/api/v3/accounts/<slug>/jobs
// ─────────────────────────────────────────────────────────────────────────────

interface WorkableJob {
  id?:          string
  shortcode?:   string
  title?:       string
  url?:         string
  application_url?: string
  description?: string
  location?:    { city?: string; country?: string }
  employment_type?: string
  workplace_type?:  string
  created_at?:  string
}

export async function fetchWorkableBoard(slug: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(
      `https://apply.workable.com/api/v3/accounts/${slug}/jobs?limit=100`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return []
    const body = await res.json()
    return ((body.results ?? body.jobs ?? []) as WorkableJob[]).map((j) => ({
      title:          j.title ?? '',
      company:        slug,
      location:       [j.location?.city, j.location?.country].filter(Boolean).join(', ') || 'Unknown',
      url:            j.application_url ?? j.url ?? (j.shortcode ? `https://apply.workable.com/${slug}/j/${j.shortcode}/` : ''),
      description:    j.description ?? '',
      employmentType: j.employment_type,
      workplaceType:  j.workplace_type,
      postedAt:       j.created_at ?? null,
      source_job_id:  j.shortcode ?? j.id ?? null,
    }))
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Recruitee — {slug}.recruitee.com/api/offers
// ─────────────────────────────────────────────────────────────────────────────

interface RecruiteeJob {
  id?:          number
  slug?:        string
  title?:       string
  careers_url?: string
  description?: string
  location?:    string
  city?:        string
  country_code?: string
  employment_type_code?: string
  remote?:      boolean
  published_at?: string
}

export async function fetchRecruiteeBoard(slug: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(
      'https://' + slug + '.recruitee.com/api/offers/',
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return []
    const body = await res.json()
    return ((body.offers ?? []) as RecruiteeJob[]).map((j) => ({
      title:          j.title ?? '',
      company:        slug,
      location:       j.location ?? ([j.city, j.country_code].filter(Boolean).join(', ') || 'Unknown'),
      url:            j.careers_url ?? (j.slug ? 'https://' + slug + '.recruitee.com/o/' + j.slug : ''),
      description:    j.description ?? '',
      employmentType: j.employment_type_code,
      workplaceType:  j.remote ? 'remote' : undefined,
      postedAt:       j.published_at ?? null,
      source_job_id:  j.id != null ? String(j.id) : null,
    }))
  } catch {
    return []
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Oracle Cloud HCM — hcmRestApi/resources/latest/recruitingCEJobRequisitions
// Companies confirmed on Oracle HCM: ON Semiconductor, Texas Instruments, DENSO
// ─────────────────────────────────────────────────────────────────────────────

export interface OracleTenant {
  host:    string   // e.g. 'hctz' (ON Semi) or 'hcwt' (TI)
  dc:      string   // e.g. 'us2'
  site:    string   // siteId param, e.g. 'CX_1001' or 'CX'
  company: string   // human-readable company name for normalization
}

interface OracleJob {
  Id?:               number | string
  Title?:            string
  PrimaryLocation?:  string
  PostingStartDate?: string
  ExternalDescriptionStr?: string
  ShortDescriptionStr?: string
  ExternalApplyURL?: string
  RequisitionNumber?: string
}

export async function fetchOracleBoard(
  t: OracleTenant,
  query: string,
  limit = 50,
): Promise<Record<string, unknown>[]> {
  const label = `${t.company} (${t.host}.${t.dc})`
  try {
    const base = `https://${t.host}.${t.dc}.oraclecloud.com`
    const url  = `${base}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`
    const params = new URLSearchParams({
      finder:  'findReqs',
      siteId:  t.site,
      keyword: query,
      limit:   String(limit),
    })
    const fullUrl = `${url}?${params.toString()}`
    console.log(`[oracle] → GET ${fullUrl}`)
    const res = await fetch(fullUrl, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.warn(`[oracle] ✗ ${label} — HTTP ${res.status} | body: ${errBody.slice(0, 300)}`)
      return []
    }
    console.log(`[oracle] ✓ ${label} — HTTP ${res.status}`)
    const body = await res.json()
    const items = (body.items ?? []) as OracleJob[]
    console.log(`[oracle] ${label} — ${items.length} posting(s) returned`)
    return items.map(j => ({
      title:         j.Title ?? '',
      company:       t.company,
      location:      j.PrimaryLocation ?? 'Unknown',
      url:           j.ExternalApplyURL ?? '',
      description:   j.ExternalDescriptionStr ?? j.ShortDescriptionStr ?? '',
      postedAt:      j.PostingStartDate ?? null,
      source_job_id: j.RequisitionNumber ?? (j.Id != null ? String(j.Id) : null),
    }))
  } catch (err) {
    console.error(`[oracle] ✗ ${label} — exception: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}
