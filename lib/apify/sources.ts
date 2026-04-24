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


// ─────────────────────────────────────────────────────────────────────────────
// Re-exports from split files — keep this file as the single import point
// for consumers that use `import * as sources from './sources'`
// ─────────────────────────────────────────────────────────────────────────────

export {
  fetchGreenhouseBoard,
  fetchLeverBoard,
  fetchAshbyBoard,
  fetchWorkdayBoard,
  fetchSmartRecruitersBoard,
  fetchWorkableBoard,
  fetchRecruiteeBoard,
  type WorkdayTenant,
} from './ats-boards'

export {
  scrapeGlassdoor,
  scrapeWellfound,
  scrapeZipRecruiter,
  scrapeClearanceJobs,
  scrapeYcWaas,
  fetchHNWhoIsHiring,
  fetchPersonioBoard,
  fetchTeamtailorBoard,
} from './specialty-boards'
