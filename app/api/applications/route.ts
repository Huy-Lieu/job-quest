// app/api/applications/route.ts
// Manually-tracked job applications.
// POST creates a canonical job entry (title → canonical_title, url → job_sources row)
// then links it to an application record.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { awardXP } from '@/lib/xp'

const JOB_SELECT = `
  id, canonical_title, company, location, job_type,
  job_sources (source_name, source_url)
`

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('applications')
    .select(`*, job:jobs(${JOB_SELECT})`)
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { job, application } = await request.json()

  // ── 1. Insert canonical job ───────────────────────────────────────────────
  // raw_hash lets the dedup pipeline recognise this job if Apify finds it later.
  const rawHash = `manual:${(job.company ?? '').toLowerCase()}|${(job.title ?? '').toLowerCase()}|${(job.location ?? '').toLowerCase()}`

  const { data: newJob, error: jobError } = await supabaseAdmin
    .from('jobs')
    .insert({
      canonical_title: job.title,
      company:         job.company,
      location:        job.location  ?? null,
      job_type:        job.job_type  ?? null,
      raw_hash:        rawHash,
      status:          'active',
    })
    .select('id')
    .single()

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 })

  // ── 2. Insert job_sources row for the URL (if provided) ───────────────────
  if (job.url) {
    await supabaseAdmin
      .from('job_sources')
      .insert({
        job_id:      newJob.id,
        source_name: 'career_page',
        source_url:  job.url,
      })
  }

  // ── 3. Create the application ─────────────────────────────────────────────
  const { data: newApp, error: appError } = await supabaseAdmin
    .from('applications')
    .insert({
      ...application,
      user_id: session.user.id,
      job_id:  newJob.id,
    })
    .select(`*, job:jobs(${JOB_SELECT})`)
    .single()

  if (appError) return NextResponse.json({ error: appError.message }, { status: 500 })

  // ── 4. Award XP ───────────────────────────────────────────────────────────
  const { xpGained, newLevel, newBadges } = await awardXP(
    session.user.id,
    newApp.status,
    newApp.id,
  )

  return NextResponse.json({ ...newApp, xpGained, newLevel, newBadges }, { status: 201 })
}
