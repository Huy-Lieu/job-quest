import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { awardXP } from '@/lib/xp'

const JOB_SELECT = `
  id, canonical_title, company, location, job_type,
  job_sources (source_name, source_url)
`

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()

  const { data, error } = await supabaseAdmin
    .from('applications')
    .update(body)
    .eq('id', id)
    .eq('user_id', session.user.id)
    .select(`*, job:jobs(${JOB_SELECT})`)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Award XP if status changed
  let xpGained = 0
  let newLevel = 1
  let newBadges: string[] = []

  if (body.status) {
    const result = await awardXP(session.user.id, body.status, id)
    xpGained = result.xpGained
    newLevel = result.newLevel
    newBadges = result.newBadges
  }

  return NextResponse.json({ ...data, xpGained, newLevel, newBadges })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabaseAdmin
    .from('applications')
    .delete()
    .eq('id', id)
    .eq('user_id', session.user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
