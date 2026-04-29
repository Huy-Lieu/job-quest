// app/api/jobs/[id]/route.ts
// GET redirects to the main feed; DELETE soft-deletes a job (status='removed').

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  void request
  void context
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json(
    {
      error:   'Individual job lookup not supported.',
      message: 'Use GET /api/jobs to browse all jobs.',
    },
    { status: 410 }
  )
}

/**
 * DELETE /api/jobs/:id
 * Soft delete — sets status='removed' so the job is hidden from the feed and
 * stays in place for the dedup layer (won't be re-scraped next run).
 *
 * Hard delete is intentionally not implemented here. Future work: optional
 * periodic SQL cleanup or user-facing purge + blocklist, without breaking dedup.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  void request
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabaseAdmin
    .from('jobs')
    .update({ status: 'removed' })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
