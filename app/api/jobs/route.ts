// GET /api/jobs — paginated job feed. Scores are optional (shown when present).

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const limit          = Math.min(parseInt(searchParams.get('limit')     ?? '20'), 50)
  const offset         = parseInt(searchParams.get('offset')    ?? '0')
  const minScore       = parseInt(searchParams.get('min_score') ?? '0')
  const source         = searchParams.get('source')
  const jobType        = searchParams.get('job_type')
  const isPhD          = searchParams.get('phd')           // 'true' | 'false' | null
  const recommended    = searchParams.get('recommended')   // 'true' to filter recommended only
  const workMode       = searchParams.get('work_mode')     // 'remote' | 'hybrid' | 'on-site' | ''
  const visa           = searchParams.get('visa')          // 'yes' | 'no' | 'unknown' | ''
  const locationSearch = searchParams.get('location')      // partial match against location string

  // ── Step 1: fetch all active jobs (with source + optional filters) ────────
  let jobsQuery = supabaseAdmin
    .from('jobs')
    .select(
      'id, canonical_title, company, location, country_code, description, salary_min, salary_max, ' +
      'salary_currency, job_type, employment_type, posted_at, scraped_at, is_phd, status, metadata, ' +
      'role_summary, skills_required, skills_preferred, tech_stack, work_mode, ' +
      'visa_sponsorship, experience_years_min, experience_years_max, education_level, ' +
      'security_clearance, benefits_highlights, languages_required, seniority_level, ' +
      'role_type, enriched_at, role_intel, application_deadline, salary_levels, ' +
      'role_company_intel, job_sources(source_name, source_url)'
    )
    .eq('status', 'active')
    .order('scraped_at', { ascending: false })

  if (jobType)        jobsQuery = jobsQuery.eq('job_type', jobType)
  if (source)         jobsQuery = jobsQuery.eq('job_sources.source_name', source)
  if (workMode)       jobsQuery = jobsQuery.eq('work_mode', workMode)
  if (visa)           jobsQuery = jobsQuery.eq('visa_sponsorship', visa)
  if (locationSearch) jobsQuery = jobsQuery.ilike('location', `%${locationSearch}%`)

  // PhD handling:
  //  - ?phd=true  → only PhD jobs (used by /dashboard/phd)
  //  - ?phd=false → only non-PhD jobs
  //  - (no param) → default to non-PhD (main job board)
  if (isPhD === 'true')  jobsQuery = jobsQuery.eq('is_phd', true)
  else if (isPhD === 'false' || isPhD == null) jobsQuery = jobsQuery.eq('is_phd', false)

  const { data: jobsRaw, error: jobsError } = await jobsQuery
  if (jobsError) return NextResponse.json({ error: jobsError.message }, { status: 500 })
  const jobs = (jobsRaw ?? []) as unknown as Array<Record<string, unknown> & { id: string }>
  if (!jobs.length) return NextResponse.json({ jobs: [], total: 0, offset, limit, hasMore: false })

  // ── Step 2: fetch any scores this user has for these jobs ─────────────────
  const jobIds = jobs.map((j) => j.id)
  const { data: scores } = await supabaseAdmin
    .from('job_scores')
    .select('job_id, fit_score, fit_reason, skills_matched, skills_missing, recommended')
    .eq('user_id', session.user.id)
    .in('job_id', jobIds)

  const scoreMap = new Map((scores ?? []).map((s) => [s.job_id, s]))

  // ── Step 3: attach score (if any), apply score-related filters ────────────
  const withScores = jobs.map((j) => ({
    ...j,
    job_scores: scoreMap.has(j.id) ? [scoreMap.get(j.id)!] : [],
  }))

  // Filter by score only when user explicitly raises minScore or toggles recommended
  const filtered = withScores.filter((j) => {
    const score = j.job_scores[0]
    if (minScore > 0 && (!score || score.fit_score < minScore)) return false
    if (recommended === 'true' && !score?.recommended) return false
    return true
  })

  // Order by scraped_at DESC — already applied by the SQL query above.
  const paginated = filtered.slice(offset, offset + limit)

  return NextResponse.json({
    jobs:    paginated,
    total:   filtered.length,
    offset,
    limit,
    hasMore: offset + limit < filtered.length,
  })
}
