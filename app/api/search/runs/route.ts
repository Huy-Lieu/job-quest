// app/api/search/runs/route.ts
// GET /api/search/runs — list recent search runs for the current user

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '10'), 50)
  const scope = searchParams.get('scope')   // 'jobs' | 'phd' | null

  // Over-fetch when scoping so we still return ~limit entries after filtering.
  const sqlLimit = scope ? Math.min(limit * 3, 150) : limit

  const { data, error } = await supabaseAdmin
    .from('search_runs')
    .select('*, search_configs(name, sources)')
    .eq('user_id', session.user.id)
    .order('started_at', { ascending: false })
    .limit(sqlLimit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const filtered = (data ?? []).filter((r) => {
    const sources = (r.search_configs as { sources?: string[] } | null)?.sources ?? []
    const isPhd = sources.includes('phd')
    if (scope === 'jobs') return !isPhd
    if (scope === 'phd')  return isPhd
    return true
  })

  return NextResponse.json(filtered.slice(0, limit))
}
