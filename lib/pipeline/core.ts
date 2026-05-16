// lib/pipeline/core.ts
// Shared pipeline logic used by both the SSE streaming route and the cron runner.
//
// Stage order (cost-optimised — no Claude at search time):
//   1. Scrape             — Apify + SerpAPI in parallel
//   2. Normalize          — raw JSON → canonical schema
//   2b.Title relevance    — drop jobs with no keyword tokens in title (free; exempts URL-targeted sources)
//   3. Dedup early        — Stage 1+2: source ID + hash (free, DB only)
//   4. Location filter    — drop jobs outside config.locations (free)
//   5. Desc enrichment    — rag-web-browser for full JD text (Workday, SmartRecruiters, Workable, Recruitee)
//   6. Dedup fuzzy        — free title-similarity check (no Claude)
//   7. Store              — jobs + job_sources → Supabase
//
// Enrichment (Haiku) and scoring (Sonnet) are on-demand only — triggered
// per-job from the detail panel, not run at search time.

import { supabaseAdmin }        from '@/lib/supabase'
import { orchestrateApify }     from '@/lib/apify/orchestrate'
import { searchGoogleJobs }     from '@/lib/serp/search'
import { normalizeJob }         from '@/lib/pipeline/normalize'
import { normalizeSerpJob }     from '@/lib/serp/normalize'
import { enrichDescriptions } from '@/lib/apify/descriptions'
import { deduplicateEarly, deduplicateFuzzy } from '@/lib/pipeline/deduplicate'

import type { NormalizedJob }  from '@/lib/pipeline/normalize'
import { inferCountryCode }    from '@/lib/pipeline/normalize'
import type { SearchConfig }   from '@/lib/types'

export interface PipelineResult {
  found:    number   // total after normalize
  survived: number   // after early dedup + location filter
  unique:   number   // after fuzzy dedup
  inserted: number   // net new rows written to jobs table
}

export type ProgressCallback = (stage: string, data: Record<string, unknown>) => void

// ── Title relevance filter ────────────────────────────────────────────────────

/**
 * Generic job-title stop-words that are too broad to use as signal on their own.
 * e.g. "engineer", "manager", "senior" appear in hundreds of unrelated roles.
 * We only accept a keyword token as a match signal if it is NOT in this set.
 */
const TITLE_STOP_WORDS = new Set([
  'engineer', 'senior', 'staff', 'principal', 'lead', 'junior', 'associate',
  'manager', 'director', 'vp', 'head', 'specialist', 'analyst', 'consultant',
  'developer', 'architect', 'scientist', 'researcher', 'intern', 'co-op',
  'software', 'hardware', 'technical', 'technology', 'tech', 'it',
  'and', 'or', 'the', 'of', 'in', 'for', 'at', 'a', 'an',
])

/**
 * Extract meaningful tokens from a keyword phrase.
 * Splits on whitespace/hyphens, lowercases, strips punctuation, drops stop-words.
 * Returns tokens that are at least 2 characters long.
 *
 * Examples:
 *   "embedded software engineer" → ["embedded"]
 *   "FPGA RTL design"            → ["fpga", "rtl", "design"]
 *   "machine learning"           → ["machine", "learning"]
 */
function extractKeywordTokens(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/[\s\-\/,]+/)
    .map(t => t.replace(/[^a-z0-9+#.]/g, ''))
    .filter(t => t.length >= 2 && !TITLE_STOP_WORDS.has(t))
}

/**
 * Filter jobs by title relevance against the search config keywords.
 *
 * A job passes if its canonical_title contains at least one meaningful token
 * from any of the keyword phrases. Jobs from URL-targeted sources
 * (greenhouse, lever, ashby, workday, career_page, phd) are exempt — those
 * sources already scope results to the target company's board and the
 * keyword is used as a search filter within that board.
 *
 * If no meaningful tokens can be extracted from any keyword (i.e. all tokens
 * are stop words), the filter is skipped entirely to avoid blocking everything.
 */
function filterByTitleRelevance(
  jobs:     NormalizedJob[],
  keywords: string[],
): NormalizedJob[] {
  if (keywords.length === 0) return jobs

  // URL-targeted sources already scope results — don't filter them by title
  const URL_TARGETED_SOURCES = new Set(['greenhouse', 'lever', 'ashby', 'workday', 'oracle', 'career_page', 'phd', 'recruitee', 'teamtailor', 'personio', 'smartrecruiters', 'workable'])

  // Build the token pool — all meaningful tokens from all keyword phrases
  const tokenPool = new Set(keywords.flatMap(extractKeywordTokens))

  if (tokenPool.size === 0) {
    // All keywords are stop-words — can't filter, let everything through
    console.log('[pipeline] title relevance filter: no usable tokens from keywords, skipping')
    return jobs
  }

  const survived: NormalizedJob[] = []
  const dropped:  NormalizedJob[] = []

  for (const job of jobs) {
    // Exempt URL-targeted sources
    if (URL_TARGETED_SOURCES.has(job.source.name)) {
      survived.push(job)
      continue
    }

    const titleLower = (job.canonical_title ?? '').toLowerCase()

    // Find the first matching token (for logging) and whether any matched
    let matchedToken: string | null = null
    for (const token of tokenPool) {
      const escaped = token.replace(/[.+]/g, '\\$&')
      if (new RegExp(`\\b${escaped}`, 'i').test(titleLower)) {
        matchedToken = token
        break
      }
    }

    if (matchedToken !== null) {
      survived.push(job)
    } else {
      dropped.push(job)
      // Log every drop with the full token pool so you can see exactly why
      console.log(
        `[pipeline] title filter DROP: "${job.canonical_title}" @ ${job.company}` +
        ` | source: ${job.source.name}` +
        ` | tested tokens: [${[...tokenPool].join(', ')}]` +
        ` | none matched title: "${titleLower}"`
      )
    }
  }

  console.log(
    '[pipeline] title relevance filter:',
    `tokens=[${[...tokenPool].join(', ')}]`,
    `input=${jobs.length}`,
    `survived=${survived.length}`,
    `dropped=${dropped.length}`,
  )

  return survived
}

// ── Location filter ───────────────────────────────────────────────────────────

const LOCATION_NAME_TO_CODE: Record<string, string> = {
  'united states': 'US', 'usa': 'US', 'us': 'US',
  'united kingdom': 'GB', 'uk': 'GB',
  'canada': 'CA',
  'australia': 'AU',
  'germany': 'DE',
  'france': 'FR',
  'netherlands': 'NL',
  'sweden': 'SE',
  'norway': 'NO',
  'denmark': 'DK',
  'finland': 'FI',
  'switzerland': 'CH',
  'israel': 'IL',
  'india': 'IN',
  'japan': 'JP',
  'singapore': 'SG',
  'vietnam': 'VN',
}

function filterByLocation(
  jobs:            NormalizedJob[],
  targetLocations: string[],
): NormalizedJob[] {
  if (targetLocations.length === 0) return jobs

  const targetCodes = new Set(
    targetLocations.map(t => {
      const lower = t.toLowerCase().trim()
      return LOCATION_NAME_TO_CODE[lower] ?? inferCountryCode(t)
    })
  )

  const survivors = jobs.filter(job => {
    const code = job.country_code ?? 'UNKNOWN'
    if (code === 'REMOTE' || code === 'MULTI') return true
    // UNKNOWN means the location string couldn't be parsed (e.g. "Bay Area", "Flexible",
    // "Greater Seattle Area") — more likely a legitimate local posting than a foreign one,
    // so pass it through rather than silently dropping it.
    if (code === 'UNKNOWN') return true
    return targetCodes.has(code)
  })

  console.log(
    '[pipeline] location filter:',
    'input='     + jobs.length,
    'codes=['    + [...targetCodes].join(', ') + ']',
    'survivors=' + survivors.length,
  )

  return survivors
}

// ── Core pipeline ─────────────────────────────────────────────────────────────

export async function runPipelineCore(
  config:      SearchConfig,
  userId:      string,
  onProgress?: ProgressCallback,
): Promise<PipelineResult> {

  const notify = (stage: string, data: Record<string, unknown> = {}) =>
    onProgress?.(stage, data)

  // ── Stage 1: Scrape ─────────────────────────────────────────────────────────
  await notify('scraping', { message: 'Scraping job sources...' })

  // SerpAPI google_jobs performs best with short queries (3-5 words).
  // Use serp_query if explicitly set; otherwise fall back to first 4 keywords.
  const query      = (config.serp_query?.trim()) || config.keywords.slice(0, 4).join(' ')
  const location   = config.locations?.[0] ?? 'United States'
  const serpOffset = config.serp_next_offset ?? 0

  // Fetch user-added Workday registry entries from DB before scraping
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: registryRows } = await (supabaseAdmin as any)
    .from('workday_registry')
    .select('key, tenant, dc, site')
    .eq('user_id', userId)
  const userWorkdayEntries = Object.fromEntries(
    ((registryRows ?? []) as { key: string; tenant: string; dc: string; site: string }[])
      .map(r => [r.key, { tenant: r.tenant, dc: r.dc, site: r.site }])
  )

  const [apifyRaw, serpResult] = await Promise.allSettled([
    orchestrateApify(config, userWorkdayEntries),
    config.serp_enabled
      ? searchGoogleJobs(query, location, 7, serpOffset)
      : Promise.resolve({ results: [], nextOffset: serpOffset }),
  ])

  const apifyResult = apifyRaw.status === 'fulfilled' ? apifyRaw.value : { jobs: [], sourceErrors: {} }
  const apifyJobs   = apifyResult.jobs
  const serpData    = serpResult.status === 'fulfilled' ? serpResult.value : { results: [], nextOffset: serpOffset }

  if (apifyRaw.status   === 'rejected') console.error('[pipeline] Apify failed:', apifyRaw.reason)
  if (serpResult.status === 'rejected') console.error('[pipeline] SerpAPI failed:', serpResult.reason)

  if (Object.keys(apifyResult.sourceErrors).length > 0) {
    await notify('warnings', { sourceErrors: apifyResult.sourceErrors })
  }

  // ── Stage 2: Normalize ──────────────────────────────────────────────────────
  await notify('normalizing', { message: 'Normalizing results...' })

  const normalizedApify: NormalizedJob[] = apifyJobs.map(raw =>
    normalizeJob(raw, (raw['source'] as string) || 'apify')
  )
  const normalizedSerp: NormalizedJob[] = serpData.results.map(normalizeSerpJob)
  const allNormalized = [...normalizedApify, ...normalizedSerp]
    .filter(j => j.canonical_title || j.company)

  await notify('normalizing', { found: allNormalized.length })

  // ── Stage 2b: Title relevance filter (free) ────────────────────────────────────────────
  // Drop jobs whose titles share no meaningful tokens with the config keywords.
  // URL-targeted sources (Greenhouse, Workday, etc.) are exempt.
  const afterTitleFilter = filterByTitleRelevance(allNormalized, config.keywords)

  // ── Stage 3: Early dedup (Stage 1+2 — free) ────────────────────────────────
  await notify('deduplicating', { message: 'Checking for duplicates...' })

  const afterEarlyDedup = await deduplicateEarly(afterTitleFilter)

  // ── Stage 4: Location filter (free) ────────────────────────────────────────
  const targetLocations = config.locations ?? []
  const afterLocationFilter = filterByLocation(afterEarlyDedup, targetLocations)

  await notify('deduplicating', { survivors: afterLocationFilter.length })

  // ── Stage 5: Workday full description fetch ──────────────────────────────────
  await notify('fetching_descriptions', { message: 'Fetching full job descriptions...' })
  const afterDescriptions = await enrichDescriptions(afterLocationFilter)

  // ── Stage 6: Fuzzy dedup — free title-similarity (no Claude) ────────────────
  const uniqueJobs = await deduplicateFuzzy(afterDescriptions)

  // Persist serp offset now that dedup succeeded
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabaseAdmin as any)
    .from('search_configs')
    .update({ serp_next_offset: serpData.nextOffset, last_run_at: new Date().toISOString() })
    .eq('id', config.id)

  await notify('deduplicating', { unique: uniqueJobs.length })

  // ── Stage 7: Store ──────────────────────────────────────────────────────────
  await notify('storing', { message: 'Saving jobs...' })

  let insertedCount = 0

  if (uniqueJobs.length > 0) {
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error: insertError } = await (supabaseAdmin as any)
      .from('jobs')
      .upsert(
        uniqueJobs.map((job) => {
          const { source, country_code, ...rest } = job
          void source
          void country_code
          return {
            ...rest,
            scraped_at: now,
          }
        }),
        { onConflict: 'raw_hash', ignoreDuplicates: true }
      )
      .select('id, raw_hash') as { data: { id: string; raw_hash: string }[] | null; error: unknown }

    if (insertError) throw new Error('Jobs insert failed: ' + String(insertError))

    const insertedJobs = inserted ?? []
    insertedCount      = insertedJobs.length
    const hashToJobId  = new Map(insertedJobs.map(j => [j.raw_hash, j.id]))

    // job_sources
    const allSources = uniqueJobs
      .map(nj => {
        const jobId = hashToJobId.get(nj.raw_hash)
        if (!jobId) return null
        return {
          job_id:        jobId,
          source_name:   nj.source.name,
          source_url:    nj.source.url,
          source_job_id: nj.source.source_job_id ?? null,
        }
      })
      .filter(Boolean)

    if (allSources.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: sourcesError } = await (supabaseAdmin as any)
        .from('job_sources')
        .insert(allSources, { ignoreDuplicates: true })
      if (sourcesError) {
        console.error('[pipeline] job_sources insert failed:', JSON.stringify(sourcesError))
      }
    }
  }

  await notify('storing', { inserted: insertedCount })

  return {
    found:    allNormalized.length,
    survived: afterLocationFilter.length,
    unique:   uniqueJobs.length,
    inserted: insertedCount,
  }
}
