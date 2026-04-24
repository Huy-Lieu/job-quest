import { supabaseAdmin } from '@/lib/supabase'
import { orchestrateApify } from '@/lib/apify/orchestrate'
import { searchGoogleJobs } from '@/lib/serp/search'
import { normalizeJob } from '@/lib/pipeline/normalize'
import { normalizeSerpJob } from '@/lib/serp/normalize'
import { enrichJobsBatch } from '@/lib/claude/enricher'
import { deduplicateJobs } from '@/lib/pipeline/deduplicate'
import { scoreJobsBatch, type EnrichedJob } from '@/lib/claude/scorer'
import type { NormalizedJob } from '@/lib/pipeline/normalize'
import type { SearchConfig } from '@/lib/types'

async function setProgress(
  runId: string,
  stage: string,
  extra: Record<string, unknown> = {}
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabaseAdmin as any)
    .from('search_runs')
    .update({ progress: { stage, ...extra } })
    .eq('id', runId)
}

export async function runPipelineForConfig(config: SearchConfig): Promise<number> {
  const userId = config.user_id

  // Create search_runs row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: run, error: runError } = await (supabaseAdmin as any)
    .from('search_runs')
    .insert({ user_id: userId, config_id: config.id, status: 'running' })
    .select('id')
    .single() as { data: { id: string } | null; error: unknown }

  if (runError || !run) throw new Error('Failed to create search_runs row')
  const runId = run.id

  try {
    // Load active resume
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
      : { skills: [], experience_years: 0, education: { degree: 'BS', field: 'Engineering' }, key_keywords: [] }

    // Stage 1: Scrape
    await setProgress(runId, 'scraping')

    const query      = config.keywords.join(' ')
    const location   = config.locations?.[0] ?? 'United States'
    const serpOffset = config.serp_next_offset ?? 0

    const [apifyResult, serpResult] = await Promise.allSettled([
      orchestrateApify(config),
      config.serp_enabled
        ? searchGoogleJobs(query, location, 7, serpOffset)
        : Promise.resolve({ results: [], nextOffset: serpOffset }),
    ])

    const apifyJobs = apifyResult.status === 'fulfilled' ? apifyResult.value : []
    const serpData  = serpResult.status  === 'fulfilled' ? serpResult.value  : { results: [], nextOffset: serpOffset }

    if (apifyResult.status === 'rejected') console.error('[cron] Apify failed for config', config.id, ':', apifyResult.reason)
    if (serpResult.status  === 'rejected') console.error('[cron] SerpAPI failed for config', config.id, ':', serpResult.reason)

    // Stage 2: Normalize
    await setProgress(runId, 'normalizing')

    const normalizedApify: NormalizedJob[] = apifyJobs.map(raw =>
      normalizeJob(raw, (raw['source'] as string) || 'apify')
    )
    const normalizedSerp: NormalizedJob[] = serpData.results.map(normalizeSerpJob)
    const allNormalized = [...normalizedApify, ...normalizedSerp]
      .filter(j => j.canonical_title || j.company)

    await setProgress(runId, 'normalizing', { found: allNormalized.length })

    // Stage 3: Enrich
    await setProgress(runId, 'enriching')

    const enrichedFields = allNormalized.length > 0
      ? await enrichJobsBatch(allNormalized)
      : []

    await setProgress(runId, 'enriching', { enriched: enrichedFields.length })

    // Stage 4: Deduplicate
    await setProgress(runId, 'deduplicating')

    const enrichedForDedup = allNormalized.map((job, i) => ({
      ...job,
      enriched: enrichedFields[i],
    })) as EnrichedJob[]

    const newJobs = await deduplicateJobs(enrichedForDedup)

    const enrichedNewJobs: EnrichedJob[] = newJobs.map(job => {
      const idx = allNormalized.findIndex(n => n.raw_hash === job.raw_hash)
      return { ...job, enriched: idx >= 0 ? enrichedFields[idx] : enrichedFields[0] } as EnrichedJob
    })

    // Persist serp offset after successful dedup
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from('search_configs')
      .update({ serp_next_offset: serpData.nextOffset })
      .eq('id', config.id)

    await setProgress(runId, 'deduplicating', { unique: newJobs.length })

    // Stage 5: Score
    await setProgress(runId, 'scoring')

    let scores: Awaited<ReturnType<typeof scoreJobsBatch>> = []
    if (enrichedNewJobs.length > 0 && resumeData.skills.length > 0) {
      scores = await scoreJobsBatch(enrichedNewJobs, resumeData)
    }

    // Stage 6: Store
    let insertedCount = 0
    let scoredCount   = 0

    if (enrichedNewJobs.length > 0) {
      const now = new Date().toISOString()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: inserted, error: insertError } = await (supabaseAdmin as any)
        .from('jobs')
        .upsert(
          enrichedNewJobs.map(({ source: _src, enriched: e, ...job }) => ({
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
          })),
          { onConflict: 'raw_hash', ignoreDuplicates: true }
        )
        .select('id, raw_hash') as { data: { id: string; raw_hash: string }[] | null; error: unknown }

      if (insertError) throw new Error('Jobs insert failed: ' + String(insertError))

      const insertedJobs = inserted ?? []
      insertedCount      = insertedJobs.length
      const hashToJobId  = new Map(insertedJobs.map(j => [j.raw_hash, j.id]))

      // job_sources — split on source_job_id presence (NULL breaks unique conflict target)
      const allSources = enrichedNewJobs
        .map(nj => {
          const jobId = hashToJobId.get(nj.raw_hash)
          if (!jobId) return null
          return { job_id: jobId, source_name: nj.source.name, source_url: nj.source.url, source_job_id: nj.source.source_job_id ?? null }
        })
        .filter(Boolean) as { job_id: string; source_name: string; source_url: string; source_job_id: string | null }[]

      const withId    = allSources.filter(s => s.source_job_id !== null)
      const withoutId = allSources.filter(s => s.source_job_id === null)

      if (withId.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: srcErr } = await (supabaseAdmin as any)
          .from('job_sources')
          .upsert(withId, { onConflict: 'source_name,source_job_id', ignoreDuplicates: true })
        if (srcErr) console.error('[cron] job_sources upsert failed:', JSON.stringify(srcErr))
      }
      if (withoutId.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: srcErr } = await (supabaseAdmin as any)
          .from('job_sources')
          .insert(withoutId)
        if (srcErr) console.error('[cron] job_sources insert (no id) failed:', JSON.stringify(srcErr))
      }

      // job_scores
      if (scores.length > 0) {
        const scoresToInsert = scores
          .map((s, i) => ({
            job_id:         hashToJobId.get(enrichedNewJobs[i]?.raw_hash ?? ''),
            user_id:        userId,
            fit_score:      s.fit_score,
            fit_reason:     s.fit_reason,
            skills_matched: s.skills_matched,
            skills_missing: s.skills_missing,
            recommended:    s.recommended,
          }))
          .filter(s => s.job_id)

        if (scoresToInsert.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: scoresErr } = await (supabaseAdmin as any)
            .from('job_scores')
            .upsert(scoresToInsert, { onConflict: 'job_id,user_id', ignoreDuplicates: true })
          if (scoresErr) console.error('[cron] job_scores upsert failed:', String(scoresErr))
          else scoredCount = scoresToInsert.length
        }
      }
    }

    // Complete: update run + config
    const now = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from('search_runs')
      .update({
        status:        'complete',
        completed_at:  now,
        jobs_found:    allNormalized.length,
        jobs_new:      insertedCount,
        jobs_enriched: enrichedFields.length,
        jobs_scored:   scoredCount,
        progress:      { stage: 'complete', found: allNormalized.length, unique: newJobs.length, scored: scoredCount, jobsAdded: insertedCount },
      })
      .eq('id', runId)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from('search_configs')
      .update({ last_run_at: now })
      .eq('id', config.id)

    console.log('[cron] Config', config.id, 'complete — found:', allNormalized.length, 'new:', insertedCount, 'scored:', scoredCount)
    return insertedCount

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from('search_runs')
      .update({ status: 'failed', error_text: message, progress: { stage: 'failed', message } })
      .eq('id', runId)
    throw err   // re-throw so caller can log and record in errors[]
  }
}
