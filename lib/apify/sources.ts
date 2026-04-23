// lib/apify/sources.ts
// Source-specific scrapers. ATS (Greenhouse/Lever/Ashby) use free public JSON APIs.
// Everything else goes through Apify actors.
//
// Also exports a typed source registry and getEnabledSources() used by the orchestrator.

import type { SearchConfig, SearchSourceName } from '@/lib/types'

// ── source registry ───────────────────────────────────────────────────────────

export interface ApifySourceConfig {
  /** Apify actor slug, e.g. "curious_coder/linkedin-jobs-scraper" */
  actorId: string
  /** Canonical source name — matches SearchSourceName in lib/types.ts */
  name: SearchSourceName
  /** Human-readable label for logging */
  label: string
  /**
   * Build the actor input object from search parameters.
   * For URL-targeted sources (ats, workday, career_page, phd) the orchestrator
   * populates options.targetUrls before calling this.
   */
  buildInput: (
    keywords:  string[],
    locations: string[],
    options?:  { targetUrls?: string[]; targetCompanies?: string[]; maxResults?: number },
  ) => Record<string, unknown>
}

export const sources: ApifySourceConfig[] = [
  {
    actorId: 'curious_coder/linkedin-jobs-scraper',
    name:    'linkedin',
    label:   'LinkedIn Jobs',
    buildInput(keywords, locations, options = {}) {
      const { targetCompanies = [], maxResults = 100 } = options
      return {
        searchQueries: keywords.map(kw => ({
          query:    kw,
          location: locations[0] ?? 'United States',
        })),
        ...(targetCompanies.length > 0 && { companies: targetCompanies }),
        maxItems:         maxResults,
        datePostedFilter: 'past-week',
        scrapeJobDetails: true,
      }
    },
  },
  {
    actorId: 'misceres/indeed-scraper',
    name:    'indeed',
    label:   'Indeed',
    buildInput(keywords, locations, options = {}) {
      const { maxResults = 100 } = options
      return {
        queries: keywords.map(kw => ({
          keyword:  kw,
          location: locations[0] ?? 'United States',
        })),
        maxItems:        maxResults,
        fromAge:         7,
        fetchJobDetails: true,
      }
    },
  },
  {
    // Covers Greenhouse, Lever, and Ashby via targetUrls
    actorId: 'apify/rag-web-browser',
    name:    'greenhouse',
    label:   'ATS Pages (Greenhouse / Lever / Ashby)',
    buildInput(keywords, _locations, options = {}) {
      const { targetUrls = [], maxResults = 50 } = options
      return {
        startUrls:    targetUrls.map(url => ({ url })),
        query:        keywords.join(' OR '),
        maxResults,
        crawlDepth:   1,
        outputFormat: 'markdown',
      }
    },
  },
  {
    actorId: 'apify/rag-web-browser',
    name:    'workday',
    label:   'Workday Career Pages',
    buildInput(keywords, _locations, options = {}) {
      const { targetUrls = [], maxResults = 50 } = options
      return {
        startUrls:    targetUrls.map(url => ({ url })),
        query:        keywords.join(' OR '),
        maxResults,
        crawlDepth:   1,
        outputFormat: 'markdown',
      }
    },
  },
  {
    actorId: 'apify/website-content-crawler',
    name:    'career_page',
    label:   'Company Career Pages',
    buildInput(_keywords, _locations, options = {}) {
      const { targetUrls = [], maxResults = 100 } = options
      return {
        startUrls:        targetUrls.map(url => ({ url })),
        maxCrawlDepth:    1,
        maxPagesPerCrawl: maxResults,
      }
    },
  },
  {
    actorId: 'apify/rag-web-browser',
    name:    'phd',
    label:   'PhD / Academic Boards',
    buildInput(keywords, _locations, options = {}) {
      const { maxResults = 50 } = options
      const defaultUrls = [
        'https://www.academicjobsonline.org/ajo/jobs',
        'https://www.nsf.gov/crssprgm/reu/list.jsp',
        'https://scholarshipdb.net/scholarships-in-United-States',
      ]
      const targetUrls = options.targetUrls?.length ? options.targetUrls : defaultUrls
      return {
        startUrls:    targetUrls.map(url => ({ url })),
        query:        [...keywords, 'PhD', 'doctoral', 'postdoc', 'fellowship'].join(' '),
        maxResults,
        crawlDepth:   1,
        outputFormat: 'markdown',
      }
    },
  },
]

const sourcesByName = new Map<SearchSourceName, ApifySourceConfig>(
  sources.map(s => [s.name, s])
)

/**
 * Return only the ApifySourceConfig entries enabled in a user's SearchConfig.
 * Sources handled outside this layer (serp, google, manual) are silently skipped.
 */
export function getEnabledSources(config: SearchConfig): ApifySourceConfig[] {
  return config.sources
    .map(name => sourcesByName.get(name))
    .filter((s): s is ApifySourceConfig => s !== undefined)
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-source scraper functions (used directly by the orchestrator)
// ─────────────────────────────────────────────────────────────────────────────

import { runApifyActor } from './search'

/** Google Jobs — structured actor (orgupdate/google-jobs-scraper).
 *  Pricing: $15 per 1,000 jobs (pay-per-result). Returns per-job apply URLs.
 *  Output fields we care about: job_title, company_name, location, URL,
 *  salary, posted_via, date.
 */
export async function scrapeGoogleJobs(query: string, pagesToFetch = 2): Promise<Record<string, unknown>[]> {
  const raw = await runApifyActor('orgupdate/google-jobs-scraper', {
    includeKeyword: query,
    countryName:    'usa',
    locationName:   'united states',
    datePosted:     'week',
    pagesToFetch,
  })
  // Normalize the actor's snake_case fields to what normalizeJob() expects.
  return (raw as Array<Record<string, unknown>>).map((j) => ({
    title:       j.job_title,
    company:     j.company_name,
    location:    j.location,
    url:         j.URL ?? j.url,
    salary:      j.salary,
    date:        j.date,
    description: j.description ?? '',
    posted_via:  j.posted_via,
  }))
}

/** LinkedIn jobs — title + optional company filter.
 *  curious_coder/linkedin-jobs-scraper expects `urls`: a list of LinkedIn Jobs search URLs.
 *  We build the URL from keywords + an optional company filter.
 */
export async function scrapeLinkedInJobs(
  keywords: string,
  companies: string[] = []
): Promise<Record<string, unknown>[]> {
  const companyFilter = companies.length ? ` ${companies.join(' OR ')}` : ''
  const q = encodeURIComponent(`${keywords}${companyFilter}`)
  const searchUrl =
    `https://www.linkedin.com/jobs/search/?keywords=${q}&location=United%20States&f_TPR=r604800`
  return runApifyActor('curious_coder/linkedin-jobs-scraper', {
    urls: [searchUrl],
    count: 50,
  })
}

/** Indeed keyword search */
export async function scrapeIndeedJobs(query: string, maxItems = 20): Promise<Record<string, unknown>[]> {
  return runApifyActor('misceres/indeed-scraper', {
    queries: [{ keyword: query, location: 'United States' }],
    maxItems,
  })
}

/** Crawl direct company career pages (watchlist URLs) */
export async function scrapeCareerPages(urls: string[]): Promise<Record<string, unknown>[]> {
  if (urls.length === 0) return []
  return runApifyActor('apify/website-content-crawler', {
    startUrls: urls.map((url) => ({ url })),
    maxCrawlDepth: 2,
    maxPagesPerCrawl: 30,
  })
}

/** PhD / academic job boards */
export async function scrapePhDBoards(keywords: string): Promise<Record<string, unknown>[]> {
  return runApifyActor('apify/rag-web-browser', {
    query: `site:academicjobsonline.org ${keywords}`,
    maxResults: 5,
    outputFormats: ['markdown'],
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// ATS JSON APIs — free, structured, no Apify credits consumed
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

/** Greenhouse board JSON — boards-api.greenhouse.io/v1/boards/<slug>/jobs */
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

/** Lever board JSON — api.lever.co/v0/postings/<slug>?mode=json */
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

/** Ashby board JSON — api.ashbyhq.com/posting-api/job-board/<slug> */
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
// Additional Apify aggregators
// ─────────────────────────────────────────────────────────────────────────────

/** Glassdoor jobs (Apify) */
export async function scrapeGlassdoor(query: string, maxItems = 20): Promise<Record<string, unknown>[]> {
  return runApifyActor('bebity/glassdoor-jobs-scraper', {
    keyword:  query,
    location: 'United States',
    maxItems,
  })
}

/** Wellfound (AngelList Talent) — structured actor (clearpath/wellfound-api-ppe).
 *  Pricing: $3.49 per 1,000 jobs (pay-per-result).
 *  Requires URL input — we slugify the query into Wellfound's /role/r/<slug> path.
 *  Output fields we care about: title, company_name, location_names, url,
 *  compensation/base_salary, description, live_start_at_readable.
 */
export async function scrapeWellfound(query: string, pageLimit = 3): Promise<Record<string, unknown>[]> {
  const slug = query.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!slug) return []
  const raw = await runApifyActor('clearpath/wellfound-api-ppe', {
    urls:           [`https://wellfound.com/role/r/${slug}`],
    pageLimit,
    onlyRemoteJobs: false,
    sortBy:         'LAST_POSTED',
    monitorMode:    false,
  })
  return (raw as Array<Record<string, unknown>>).map((j) => {
    const locs = j.location_names
    const location = Array.isArray(locs) && locs.length > 0 ? String(locs[0]) : 'Unknown'
    return {
      title:       j.title,
      company:     j.company_name,
      location,
      url:         j.url,
      salary:      j.compensation ?? j.base_salary,
      description: j.description ?? '',
      postedAt:    j.live_start_at_readable,
    }
  })
}

/** ZipRecruiter (Apify) — fatihtahta/ziprecruiter-scraper, pay-per-use ($2.49/1k jobs) */
export async function scrapeZipRecruiter(query: string, limit = 20): Promise<Record<string, unknown>[]> {
  return runApifyActor('fatihtahta/ziprecruiter-scraper', {
    queries:  [query],
    location: 'United States',
    days:     '10',
    limit,
  })
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

/** Workday posting JSON — paginated POST endpoint. */
export async function fetchWorkdayBoard(
  t: WorkdayTenant,
  query: string,
  limit = 20
): Promise<Record<string, unknown>[]> {
  try {
    const base = `https://${t.tenant}.${t.dc}.myworkdayjobs.com`
    const res = await fetch(
      `${base}/wday/cxs/${t.tenant}/${t.site}/jobs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit, offset: 0, searchText: query }),
      }
    )
    if (!res.ok) return []
    const body = await res.json()
    const postings = (body.jobPostings ?? []) as WorkdayJob[]
    return postings.map((j) => ({
      title:         j.title ?? '',
      company:       t.tenant,
      location:      j.locationsText ?? 'Unknown',
      url:           j.externalPath ? `${base}${j.externalPath}` : '',
      description:   (j.bulletFields ?? []).join('\n'),
      postedAt:      j.postedOn ?? null,
      source_job_id: j.externalPath ?? null,
    }))
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SmartRecruiters — public postings API per company slug
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
// ClearanceJobs — via Apify rag-web-browser with site: filter (no dedicated actor)
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeClearanceJobs(query: string, maxResults = 15): Promise<Record<string, unknown>[]> {
  return runApifyActor('apify/rag-web-browser', {
    query: `site:clearancejobs.com ${query}`,
    maxResults,
    outputFormats: ['markdown'],
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// YC Work at a Startup — Apify rag-web-browser with site: filter
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeYcWaas(query: string, maxResults = 10): Promise<Record<string, unknown>[]> {
  return runApifyActor('apify/rag-web-browser', {
    query: `site:workatastartup.com ${query}`,
    maxResults,
    outputFormats: ['markdown'],
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// HN "Who is Hiring" — Algolia search + HN Firebase item API
// ─────────────────────────────────────────────────────────────────────────────

interface HNItem {
  id?:   number
  text?: string
  kids?: number[]
  by?:   string
  time?: number
  dead?: boolean
  deleted?: boolean
}

/** Find newest "Ask HN: Who is hiring?" thread and return comments matching any keyword. */
export async function fetchHNWhoIsHiring(keywords: string[]): Promise<Record<string, unknown>[]> {
  try {
    const search = await fetch(
      'https://hn.algolia.com/api/v1/search?query=Ask+HN+Who+is+hiring&tags=story&hitsPerPage=3'
    )
    if (!search.ok) return []
    const { hits } = await search.json() as { hits: Array<{ objectID: string; title?: string; created_at_i?: number }> }
    const hiring = hits
      .filter((h) => /who is hiring/i.test(h.title ?? ''))
      .sort((a, b) => (b.created_at_i ?? 0) - (a.created_at_i ?? 0))[0]
    if (!hiring) return []

    const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${hiring.objectID}.json`)
    const story = await storyRes.json() as HNItem
    const kidIds = (story.kids ?? []).slice(0, 200) // cap to keep request count sane

    const kids = await Promise.allSettled(
      kidIds.map((id) => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then((r) => r.json() as Promise<HNItem>))
    )
    const comments = kids
      .filter((r): r is PromiseFulfilledResult<HNItem> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((c) => c && !c.dead && !c.deleted && c.text)

    const kwRe = keywords.length
      ? new RegExp(keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
      : null

    return comments
      .filter((c) => !kwRe || (c.text && kwRe.test(c.text)))
      .map((c) => {
        const text = (c.text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        const firstLine = text.split(/[.\n|·|•]/)[0]?.trim() ?? ''
        const companyMatch = firstLine.match(/^([A-Z][A-Za-z0-9&.\- ]{1,40})(?:\s*[|\-–—]|\s+is\b|\s+\()/)
        const company = companyMatch?.[1]?.trim() || firstLine.slice(0, 40)
        return {
          title:         firstLine.slice(0, 200) || `HN Hiring post ${c.id}`,
          company,
          location:      'Unknown',
          url:           `https://news.ycombinator.com/item?id=${c.id}`,
          description:   text.slice(0, 2000),
          postedAt:      c.time ? new Date(c.time * 1000).toISOString() : null,
          source_job_id: String(c.id ?? ''),
        }
      })
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Workable — public account jobs API
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


// Recruitee - {slug}.recruitee.com/api/offers

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

// Teamtailor - {slug}.teamtailor.com/jobs.json

interface TeamtailorJob {
  id?:          string | number
  title?:       string
  body?:        string
  careersite_url?: string
  apply_url?:   string
  locations?:   Array<{ name?: string }>
  employment_type?: string
  remote_status?: string
  published_at?: string
}

export async function fetchTeamtailorBoard(slug: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(
      'https://' + slug + '.teamtailor.com/jobs.json',
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return []
    const body = await res.json()
    const jobs = (Array.isArray(body) ? body : body.jobs ?? []) as TeamtailorJob[]
    return jobs.map((j) => ({
      title:          j.title ?? '',
      company:        slug,
      location:       j.locations?.map((l) => l.name).filter(Boolean).join(', ') || 'Unknown',
      url:            j.apply_url ?? j.careersite_url ?? '',
      description:    j.body ?? '',
      employmentType: j.employment_type,
      workplaceType:  j.remote_status === 'fully' ? 'remote' : undefined,
      postedAt:       j.published_at ?? null,
      source_job_id:  j.id != null ? String(j.id) : null,
    }))
  } catch {
    return []
  }
}

// Personio - XML feed at {slug}.jobs.personio.de/xml

function xmlTag(block: string, tag: string): string {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'))
  if (!m) return ''
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

export async function fetchPersonioBoard(slug: string): Promise<Record<string, unknown>[]> {
  try {
    let res = await fetch('https://' + slug + '.jobs.personio.de/xml', { headers: { Accept: 'application/xml' } })
    if (!res.ok) {
      res = await fetch('https://' + slug + '.jobs.personio.com/xml', { headers: { Accept: 'application/xml' } })
    }
    if (!res.ok) return []
    const xml = await res.text()
    const positions = xml.match(/<position[\s\S]*?<\/position>/gi) ?? []
    return positions.map((block) => {
      const id          = xmlTag(block, 'id')
      const title       = xmlTag(block, 'name')
      const office      = xmlTag(block, 'office')
      const department  = xmlTag(block, 'department')
      const description = xmlTag(block, 'jobDescriptions') || xmlTag(block, 'description')
      const employment  = xmlTag(block, 'employmentType')
      const schedule    = xmlTag(block, 'schedule')
      const createdAt   = xmlTag(block, 'createdAt')
      return {
        title,
        company:        slug,
        location:       office || 'Unknown',
        url:            id ? 'https://' + slug + '.jobs.personio.de/job/' + id : '',
        description:    (department ? department + '\n\n' : '') + description,
        employmentType: employment || schedule,
        postedAt:       createdAt || null,
        source_job_id:  id || null,
      }
    })
  } catch {
    return []
  }
}
