// app/api/jobs/[id]/enrich/route.ts
// POST /api/jobs/:id/enrich
// On-demand Claude Haiku enrichment for a single job.
// Calls enrichJobsBatch with the job row, persists the result to the DB,
// and returns the enriched fields (including role_intel) to the UI.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { enrichJobsBatch } from '@/lib/claude/enricher'
import type { NormalizedJob } from '@/lib/pipeline/normalize'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  void request
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Fetch the job row
  const { data: job, error: fetchErr } = await supabaseAdmin
    .from('jobs')
    .select('id, canonical_title, company, location, description, job_type, salary_min, salary_max, employment_type, posted_at, is_phd, raw_hash, metadata, visa_sponsorship, security_clearance, work_mode, experience_years_min, experience_years_max, tech_stack, benefits_highlights')
    .eq('id', id)
    .single()

  if (fetchErr || !job) {
    return NextResponse.json({ error: fetchErr?.message ?? 'Job not found' }, { status: 404 })
  }

  // Build a minimal NormalizedJob shape for the enricher
  const normalized: NormalizedJob & { id: string } = {
    id:                   job.id,
    canonical_title:      job.canonical_title ?? '',
    company:              job.company ?? '',
    location:             job.location ?? '',
    country_code:         'US',
    description:          job.description ?? '',
    salary_min:           job.salary_min ?? null,
    salary_max:           job.salary_max ?? null,
    salary_currency:      'USD',
    job_type:             job.job_type ?? 'full_time',
    employment_type:      job.employment_type ?? 'unknown',
    posted_at:            job.posted_at ?? null,
    is_phd:               job.is_phd ?? false,
    raw_hash:             job.raw_hash ?? '',
    metadata:             job.metadata ?? {},
    visa_sponsorship:     (job.visa_sponsorship as 'yes' | 'no' | 'unknown') ?? 'unknown',
    security_clearance:   (job.security_clearance as 'none' | 'preferred' | 'required') ?? 'none',
    work_mode:            (job.work_mode as 'remote' | 'hybrid' | 'on-site' | null) ?? null,
    experience_years_min: job.experience_years_min ?? null,
    experience_years_max: job.experience_years_max ?? null,
    tech_stack:           job.tech_stack ?? [],
    benefits_highlights:  job.benefits_highlights ?? [],
    application_deadline: null,
    salary_levels:        null,
    source: { name: 'manual', url: '', source_job_id: null },
  }

  // Run Haiku enrichment (single-job batch)
  let enriched: Awaited<ReturnType<typeof enrichJobsBatch>>
  try {
    enriched = await enrichJobsBatch([normalized])
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  const result = enriched[0]
  if (!result) {
    return NextResponse.json({ error: 'Enrichment returned no results' }, { status: 500 })
  }

  // Persist enriched fields back to the jobs table
  const { error: updateErr } = await supabaseAdmin
    .from('jobs')
    .update({
      role_summary:          result.role_summary,
      skills_required:       result.skills_required,
      skills_preferred:      result.skills_preferred,
      tech_stack:            result.tech_stack,
      work_mode:             result.work_mode,
      visa_sponsorship:      result.visa_sponsorship,
      experience_years_min:  result.experience_years_min,
      experience_years_max:  result.experience_years_max,
      education_level:       result.education_level,
      security_clearance:    result.security_clearance,
      benefits_highlights:   result.benefits_highlights,
      languages_required:    result.languages_required,
      seniority_level:       result.seniority_level,
      role_type:             result.role_type,
      role_intel:            result.role_intel,
      enriched_at:           new Date().toISOString(),
    })
    .eq('id', id)

  if (updateErr) {
    console.error('[enrich] DB update error:', updateErr.message)
  }

  return NextResponse.json({
    role_intel:       result.role_intel,
    role_summary:     result.role_summary,
    skills_required:  result.skills_required,
    skills_preferred: result.skills_preferred,
    ats_keywords:     result.role_intel?.ats_keywords ?? [],
  })
}
