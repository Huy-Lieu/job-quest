// app/api/search/stream/route.ts
// SSE streaming job search pipeline — fires Apify + SerpAPI in parallel, then
// normalize → enrich → dedup → score → store, emitting progress at each stage.

import { NextResponse }    from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { supabaseAdmin }    from '@/lib/supabase'

import { orchestrateApify }  from '@/lib/apify/orchestrate'
import { searchGoogleJobs }  from '@/lib/serp/search'
import { normalizeJob }      from '@/lib/pipeline/normalize'
import { normalizeSerpJob }  from '@/lib/serp/normalize'
import { enrichJobsBatch }   from '@/lib/claude/enricher'
import { deduplicateJobs }   from '@/lib/pipeline/deduplicate'
import { scoreJobsBatch, type EnrichedJob } from '@/lib/claude/scorer'

import type { NormalizedJob }     from '@/lib/pipeline/normalize'
import type { SearchConfig }      from '@/lib/types'

export const maxDuration = 300
export const dynamic     = 'force-dynamic'

// ── SSE helpers ───────────────────────────────────────────────────────────────

interface ProgressPayload {
  stage:     string
  progress:  number
  message?:  string
  found?:    number
  enriched?: number
  unique?:   number
  scored?:   number
  jobsAdded?: number
}

function makeStream() {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array>

  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c },
  })

  function emit(event: string, data: object) {
    const chunk = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'
    controller.enqueue(encoder.encode(chunk))
  }

  function close() {
    try { controller.close() } catch { /* already closed */ }
  }

  return { stream, emit, close }
}

// ── GET handler ───────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const configId = searchParams.get('configId') ?? searchParams.get('searchConfigId')

  if (!configId) {
    return NextResponse.json({ error: 'configId is required' }, { status: 400 })
  }

  const userId = session.user.id
  const { stream, emit, close } = makeStream()

  // Run pipeline in background — response streams independently
  runPipeline(userId, configId, emit, close).catch(err => {
    console.error('[search/stream] Unhandled pipeline error:', err)
    close()
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}

// ── pipeline ──────────────────────────────────────────────────────────────────

async function runPipeline(
  userId:   string,
  configId: string,
  emit:     (event: string, data: object) => void,
  close:    () => void,
) {
  // ── Load search config ──────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: config, error: configError } = await (supabaseAdmin as any)
    .from('search_configs')
    .select('*')
    .eq('id', configId)
    .eq('user_id', userId)
    .single() as { data: SearchConfig | null; error: unknown }

  if (configError || !config) {
    emit('error', { message: 'Search config not found' })
    close()
    return
  }

  // ── Create search run row ───────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: run, error: runError } = await (supabaseAdmin as any)
    .from('search_runs')
    .insert({ user_id: userId, config_id: configId, status: 'running' })
    .select()
    .single() as { data: { id: string } | null; error: unknown }

  if (runError || !run) {
    emit('error', { message: 'Failed to create search run' })
    close()
    return
  }

  const runId = run.id

  /** Write progress to the polling fallback column and emit SSE event. */
  async function progress(payload: ProgressPayload) {
    emit('progress', payload)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from('search_runs')
      .update({ progress: payload })
      .eq('id', runId)
  }

  /** Mark run failed, emit error event, close stream. */
  async function fail(message: string) {
    emit('error', { message })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from('search_runs')
      .update({ status: 'failed', error_text: message })
      .eq('id', runId)
    close()
  }

  try {
    // ── Load active resume ────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: resume } = await (supabaseAdmin as any)
      .from('resumes')
      .select('parsed_skills, parsed_experience, parsed_education')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single() as { data: { parsed_skills: string[] | null; parsed_experience: unknown[] | null; parsed_education: Array<{ degree?: string; field?: string }> | null } | null }

    const resumeData = resume
      ? {
          skills:           resume.parsed_skills ?? [],
          experience_years: (resume.parsed_experience ?? []).length,
          education:        { degree: resume.parsed_education?.[0]?.degree ?? 'BS', field: resume.parsed_education?.[0]?.field ?? 'Engineering' },
          key_keywords:     resume.parsed_skills ?? [],
        }
      : { skills: [], experience_years: 0, education: { degree: 'BS', field: 'Engineering' }, key_keywords: [] }

    // ── Stage 1: Scraping ─────────────────────────────────────────────────────
    await progress({ stage: 'scraping', progress: 10, message: 'Scraping job sources...' })

    const query    = config.keywords.join(' ')
    const location = config.locations?.[0] ?? 'United States'
    const serpOffset = config.serp_next_offset ?? 0

    const [apifyRaw, serpResult] = await Promise.allSettled([
      orchestrateApify(config),
      config.serp_enabled
        ? searchGoogleJobs(query, location, 7, serpOffset)
        : Promise.resolve({ results: [], nextOffset: serpOffset }),
    ])

    const apifyJobs = apifyRaw.status === 'fulfilled' ? apifyRaw.value : []
    const serpData  = serpResult.status === 'fulfilled' ? serpResult.value : { results: [], nextOffset: serpOffset }

    if (apifyRaw.status === 'rejected') {
      console.error('[search/stream] Apify failed:', apifyRaw.reason)
    }
    if (serpResult.status === 'rejected') {
      console.error('[search/stream] SerpAPI failed:', serpResult.reason)
    }

    // ── Stage 2: Normalize ────────────────────────────────────────────────────
    await progress({ stage: 'normalizing', progress: 25, message: 'Normalizing results...' })

    const normalizedApify: NormalizedJob[] = apifyJobs.map(raw =>
      normalizeJob(raw, (raw['source'] as string) || 'apify')
    )
    const normalizedSerp: NormalizedJob[] = serpData.results.map(normalizeSerpJob)
    const allNormalized = [...normalizedApify, ...normalizedSerp]
      .filter(j => j.canonical_title || j.company)

    await progress({ stage: 'normalizing', progress: 25, found: allNormalized.length })

    // ── Stage 3: Enrich ───────────────────────────────────────────────────────
    await progress({ stage: 'enriching', progress: 45, message: 'Enriching with Claude Haiku...' })

    const enrichedFields = allNormalized.length > 0
      ? await enrichJobsBatch(allNormalized)
      : []

    await progress({ stage: 'enriching', progress: 45, enriched: enrichedFields.length })

    // ── Stage 4: Deduplicate ──────────────────────────────────────────────────
    await progress({ stage: 'deduplicating', progress: 60, message: 'Deduplicating...' })

    const enrichedForDedup = allNormalized.map((job, i) => ({
      ...job,
      enriched: enrichedFields[i],
    })) as EnrichedJob[]

    // Deduplicator works on NormalizedJob[] (EnrichedJob extends NormalizedJob)
    const newJobs = await deduplicateJobs(enrichedForDedup)

    // Zip deduped jobs with their enriched fields
    const enrichedNewJobs: EnrichedJob[] = newJobs.map(job => {
      const idx = allNormalized.findIndex(n => n.raw_hash === job.raw_hash)
      return {
        ...job,
        enriched: idx >= 0 ? enrichedFields[idx] : enrichedFields[0],
      } as EnrichedJob
    })

    // Persist serp_next_offset now that dedup succeeded
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from('search_configs')
      .update({ serp_next_offset: serpData.nextOffset, last_run_at: new Date().toISOString() })
      .eq('id', configId)

    await progress({ stage: 'deduplicating', progress: 60, unique: newJobs.length })

    // ── Stage 5: Score ────────────────────────────────────────────────────────
    await progress({ stage: 'scoring', progress: 80, message: 'Scoring with Claude Sonnet...' })

    let scores: Awaited<ReturnType<typeof scoreJobsBatch>> = []
    if (enrichedNewJobs.length > 0 && resumeData.skills.length > 0) {
      scores = await scoreJobsBatch(enrichedNewJobs, resumeData)
    }

    await progress({ stage: 'scoring', progress: 80, scored: scores.length })

    // ── Stage 6: Store ────────────────────────────────────────────────────────
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

      if (insertError) {
        await fail('Jobs insert failed: ' + String(insertError))
        return
      }

      const insertedJobs   = inserted ?? []
      insertedCount        = insertedJobs.length
      const hashToJobId    = new Map(insertedJobs.map(j => [j.raw_hash, j.id]))

      // job_sources
      const sourcesToInsert = enrichedNewJobs
        .map(nj => {
          const jobId = hashToJobId.get(nj.raw_hash)
          if (!jobId) return null
          return {
            job_id:        jobId,
            source_name:   nj.source.name,
            source_url:    nj.source.url,
            source_job_id: nj.source.source_job_id,
          }
        })
        .filter(Boolean)

      if (sourcesToInsert.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: sourcesError } = await (supabaseAdmin as any)
          .from('job_sources')
          .upsert(sourcesToInsert, { onConflict: 'source_name,source_job_id', ignoreDuplicates: true })
        if (sourcesError) {
          console.error('[search/stream] job_sources upsert failed:', String(sourcesError))
        }
      }

      // job_scores
      if (scores.length > 0) {
        const scoresToInsert = scores
          .map((s, i) => {
            if (!s) return null
            const jobId = hashToJobId.get(enrichedNewJobs[i]?.raw_hash ?? '')
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
            console.error('[search/stream] job_scores upsert failed:', String(scoresError))
          } else {
            scoredCount = scoresToInsert.length
          }
        }
      }
    }

    // ── Update search run ─────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from('search_runs')
      .update({
        status:        'complete',
        completed_at:  new Date().toISOString(),
        jobs_found:    allNormalized.length,
        jobs_new:      insertedCount,
        jobs_enriched: enrichedFields.length,
        jobs_scored:   scoredCount,
      })
      .eq('id', runId)

    // ── Complete ──────────────────────────────────────────────────────────────
    emit('complete', {
      stage:     'complete',
      progress:  100,
      found:     allNormalized.length,
      enriched:  enrichedFields.length,
      unique:    newJobs.length,
      scored:    scoredCount,
      jobsAdded: insertedCount,
      runId,
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await fail(message)
    return
  }

  close()
}
