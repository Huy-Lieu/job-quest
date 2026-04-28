// lib/pipeline/core.ts
// Shared pipeline logic used by both the SSE streaming route and the cron runner.
//
// Stage order (cost-optimised):
//   1. Scrape        — Apify + SerpAPI in parallel
//   2. Normalize     — raw JSON → canonical schema
//   3. Dedup early   — Stage 1+2: source ID + hash (free, DB only)
//   4. Location filter — drop jobs outside config.locations (free)
//   5. Enrich        — Claude Haiku extracts structured fields (paid)
//   6. Dedup fuzzy   — Stage 3: Claude Haiku YES/NO (paid, needs enriched data)
//   7. Score         — Claude Sonnet fit score vs active resume (paid)
//   8. Store         — jobs + job_sources + job_scores → Supabase
//
// Haiku and Sonnet only run on jobs that survived the free stages, minimising cost.

import { supabaseAdmin }        from '@/lib/supabase'
import { orchestrateApify }     from '@/lib/apify/orchestrate'
import { searchGoogleJobs }     from '@/lib/serp/search'
import { normalizeJob }         from '@/lib/pipeline/normalize'
import { normalizeSerpJob }     from '@/lib/serp/normalize'
import { enrichWorkdayDescriptions } from '@/lib/apify/descriptions'
import { enrichJobsBatch }      from '@/lib/claude/enricher'
import { deduplicateEarly, deduplicateFuzzy } from '@/lib/pipeline/deduplicate'
import { scoreJobsBatch, type EnrichedJob }   from '@/lib/claude/scorer'

import type { NormalizedJob }  from '@/lib/pipeline/normalize'
import { inferCountryCode }    from '@/lib/pipeline/normalize'
import type { SearchConfig }   from '@/lib/types'

export interface PipelineResult {
  found:    number   // total after normalize
  survived: number   // after early dedup + location filter (what Haiku sees)
  enriched: number   // after Haiku enrich
  unique:   number   // after fuzzy dedup (what Sonnet scores)
  inserted: number   // net new rows written to jobs table
  scored:   number   // rows written to job_scores
}

export type ProgressCallback = (stage: string, data: Record<string, unknown>) => void

// ── Location filter ───────────────────────────────────────────────────────────

/**
 * Maps user-facing location names → ISO 3166-1 alpha-2 country codes.
 * This lets users type "United States" in the UI and have it match
 * jobs with country_code = "US" regardless of how each scraper formats
 * the location string.
 */
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

/**
 * Filter jobs to only those matching target locations.
 *
 * Uses country_code (ISO 3166-1 alpha-2) for exact matching — not substring.
 * This means "United States" matches "Santa Ana, CA", "Austin, TX", and
 * "San Francisco, CA" equally, regardless of how the scraper formatted them.
 *
 * Special codes:
 *   REMOTE — always passes (remote jobs are location-agnostic)
 *   MULTI  — always passes (can't determine countries without detail API)
 *   UNKNOWN — excluded (no location data, can't verify)
 *
 * If targetLocations is empty, all jobs pass.
 */
function filterByLocation(
  jobs:            NormalizedJob[],
  targetLocations: string[],
): NormalizedJob[] {
  if (targetLocations.length === 0) return jobs

  // Convert user-facing names to ISO codes: "United States" → "US"
  const targetCodes = new Set(
    targetLocations.map(t => {
      const lower = t.toLowerCase().trim()
      return LOCATION_NAME_TO_CODE[lower] ?? inferCountryCode(t)
    })
  )

  const survivors = jobs.filter(job => {
    const code = job.country_code ?? 'UNKNOWN'
    if (code === 'REMOTE' || code === 'MULTI') return true
    if (code === 'UNKNOWN') return false
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

/**
 * Run the full job search pipeline for a given search config.
 *
 * @param config      The user's search config (keywords, locations, sources, etc.)
 * @param userId      Owning user's ID — used for resume load and job_scores insert
 * @param onProgress  Optional callback fired at each stage boundary.
 *                    The SSE route uses this to emit progress events and check
 *                    cancellation; the cron runner writes to search_runs.progress.
 */
export async function runPipelineCore(
  config:      SearchConfig,
  userId:      string,
  onProgress?: ProgressCallback,
): Promise<PipelineResult> {

  const notify = (stage: string, data: Record<string, unknown> = {}) =>
    onProgress?.(stage, data)

  // ── Load active resume ──────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: resume } = await (supabaseAdmin as any)
    .from('resumes')
    .select('parsed_skills, parsed_experience, parsed_education')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single() as {
      data: {
        parsed_skills:     string[] | null
        parsed_experience: unknown[] | null
        parsed_education:  Array<{ degree?: string; field?: string }> | null
      } | null
    }

  const resumeData = resume
    ? {
        skills:           resume.parsed_skills ?? [],
        experience_years: (resume.parsed_experience ?? []).length,
        education: {
          degree: resume.parsed_education?.[0]?.degree ?? 'BS',
          field:  resume.parsed_education?.[0]?.field  ?? 'Engineering',
        },
        key_keywords: resume.parsed_skills ?? [],
      }
    : {
        skills:           [],
        experience_years: 0,
        education:        { degree: 'BS', field: 'Engineering' },
        key_keywords:     [],
      }

  // ── Stage 1: Scrape ─────────────────────────────────────────────────────────
  await notify('scraping', { message: 'Scraping job sources...' })

  const query      = config.keywords.join(' ')
  const location   = config.locations?.[0] ?? 'United States'
  const serpOffset = config.serp_next_offset ?? 0

  const [apifyRaw, serpResult] = await Promise.allSettled([
    orchestrateApify(config),
    config.serp_enabled
      ? searchGoogleJobs(query, location, 7, serpOffset)
      : Promise.resolve({ results: [], nextOffset: serpOffset }),
  ])

  const apifyJobs = apifyRaw.status  === 'fulfilled' ? apifyRaw.value  : []
  const serpData  = serpResult.status === 'fulfilled' ? serpResult.value : { results: [], nextOffset: serpOffset }

  if (apifyRaw.status  === 'rejected') console.error('[pipeline] Apify failed:', apifyRaw.reason)
  if (serpResult.status === 'rejected') console.error('[pipeline] SerpAPI failed:', serpResult.reason)

  // ── Stage 2: Normalize ──────────────────────────────────────────────────────
  await notify('normalizing', { message: 'Normalizing results...' })

  const normalizedApify: NormalizedJob[] = apifyJobs.map(raw =>
    normalizeJob(raw, (raw['source'] as string) || 'apify')
  )
  const normalizedSerp: NormalizedJob[] = serpData.results.map(normalizeSerpJob)
  const allNormalized = [...normalizedApify, ...normalizedSerp]
    .filter(j => j.canonical_title || j.company)

  await notify('normalizing', { found: allNormalized.length })

  // ── Stage 3: Early dedup (Stage 1+2 — free) ────────────────────────────────
  await notify('deduplicating', { message: 'Checking for duplicates...' })

  const afterEarlyDedup = await deduplicateEarly(allNormalized)

  // ── Stage 4: Location filter (free) ────────────────────────────────────────
  const targetLocations = config.locations ?? []
  const afterLocationFilter = filterByLocation(afterEarlyDedup, targetLocations)

  await notify('deduplicating', { survivors: afterLocationFilter.length })

  // ── Stage 5a: Fetch full descriptions — Workday survivors only ───────────
  // Workday's listing API returns bullet fragments. For jobs that passed the
  // location filter, we fire Apify rag-web-browser against the apply URL to
  // get the full rendered JD text before Haiku enrichment.
  await notify('fetching_descriptions', { message: 'Fetching full job descriptions...' })

  const afterDescriptions = await enrichWorkdayDescriptions(afterLocationFilter)

  // ── Stage 5b: Enrich — Claude Haiku (paid — only surviving jobs) ──────────
  await notify('enriching', { message: 'Enriching with Claude Haiku...' })

  const enrichedFields = afterDescriptions.length > 0
    ? await enrichJobsBatch(afterDescriptions)
    : []

  await notify('enriching', { enriched: enrichedFields.length })

  // ── Stage 6: Fuzzy dedup — Claude Haiku (paid — needs enriched data) ───────
  const enrichedForFuzzy = afterDescriptions.map((job, i) => ({
    ...job,
    enriched: enrichedFields[i],
  })) as EnrichedJob[]

  const uniqueJobs = await deduplicateFuzzy(enrichedForFuzzy)

  // Persist serp offset now that dedup succeeded
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabaseAdmin as any)
    .from('search_configs')
    .update({ serp_next_offset: serpData.nextOffset, last_run_at: new Date().toISOString() })
    .eq('id', config.id)

  await notify('deduplicating', { unique: uniqueJobs.length })

  // ── Stage 7: Score — Claude Sonnet (paid — only final unique jobs) ──────────
  await notify('scoring', { message: 'Scoring with Claude Sonnet...' })

  let scores: Awaited<ReturnType<typeof scoreJobsBatch>> = []
  if (uniqueJobs.length > 0 && resumeData.skills.length > 0) {
    scores = await scoreJobsBatch(uniqueJobs as EnrichedJob[], resumeData)
  }

  await notify('scoring', { scored: scores.length })

  // ── Stage 8: Store ──────────────────────────────────────────────────────────
  let insertedCount = 0
  let scoredCount   = 0

  if (uniqueJobs.length > 0) {
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error: insertError } = await (supabaseAdmin as any)
      .from('jobs')
      .upsert(
        (uniqueJobs as EnrichedJob[]).map(({ source: _src, enriched: e, country_code: _cc, ...job }) => ({
          ...job,
          scraped_at:           now,
          role_summary:         e.role_summary         || null,
          skills_required:      e.skills_required,
          skills_preferred:     e.skills_preferred,
          tech_stack:           e.tech_stack,
          work_mode:            e.work_mode,
          visa_sponsorship:     e.visa_sponsorship,
          experience_years_min: e.experience_years_min,
          experience_years_max: e.experience_years_max,
          education_level:      e.education_level,
          security_clearance:   e.security_clearance,
          benefits_highlights:  e.benefits_highlights,
          languages_required:   e.languages_required,
          seniority_level:      e.seniority_level,
          role_type:            e.role_type,
          salary_min:           job.salary_min ?? e.salary_min,
          salary_max:           job.salary_max ?? e.salary_max,
          salary_currency:      job.salary_currency || e.salary_currency || 'USD',
          enriched_at:          now,
          role_intel:           e.role_intel ?? null,
          application_deadline: e.application_deadline ?? null,
          salary_levels:        e.salary_levels ?? null,
        })),
        { onConflict: 'raw_hash', ignoreDuplicates: true }
      )
      .select('id, raw_hash') as { data: { id: string; raw_hash: string }[] | null; error: unknown }

    if (insertError) throw new Error('Jobs insert failed: ' + String(insertError))

    const insertedJobs = inserted ?? []
    insertedCount      = insertedJobs.length
    const hashToJobId  = new Map(insertedJobs.map(j => [j.raw_hash, j.id]))

    // job_sources — ignoreDuplicates lets the DB partial unique index handle dedup
    const allSources = (uniqueJobs as EnrichedJob[])
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

    // job_scores
    if (scores.length > 0) {
      const scoresToInsert = scores
        .map((s, i) => {
          if (!s) return null
          const jobId = hashToJobId.get((uniqueJobs[i] as NormalizedJob)?.raw_hash ?? '')
          if (!jobId) return null
          return {
            job_id:         jobId,
            user_id:        userId,
            fit_score:      s.fit_score,
            fit_reason:     s.fit_reason,
            skills_matched: s.skills_matched,
            skills_missing: s.skills_missing,
            recommended:    s.recommended,
          }
        })
        .filter(Boolean)


      if (scoresToInsert.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: scoresError } = await (supabaseAdmin as any)
          .from('job_scores')
          .upsert(scoresToInsert, { onConflict: 'job_id,user_id', ignoreDuplicates: true })
        if (scoresError) {
          console.error('[pipeline] job_scores upsert failed:', String(scoresError))
        } else {
          scoredCount = scoresToInsert.length
        }
      }
    }
  }

  return {
    found:    allNormalized.length,
    survived: afterLocationFilter.length,
    enriched: enrichedFields.length,
    unique:   uniqueJobs.length,
    inserted: insertedCount,
    scored:   scoredCount,
  }
}
