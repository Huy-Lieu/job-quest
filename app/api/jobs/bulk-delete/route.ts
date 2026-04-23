// app/api/jobs/bulk-delete/route.ts
// POST { ids: string[] } → soft-delete all matching jobs (status='removed').

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ids } = (await request.json()) as { ids?: unknown }
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === 'string')) {
    return NextResponse.json({ error: 'Expected { ids: string[] }' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('jobs')
    .update({ status: 'removed' })
    .in('id', ids as string[])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, count: ids.length })
}
