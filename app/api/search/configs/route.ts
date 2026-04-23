// app/api/search/configs/route.ts
// GET  /api/search/configs — list the current user's active search configs
// POST /api/search/configs — create a new search config

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const scope = searchParams.get('scope')   // 'jobs' | 'phd' | null

  const { data, error } = await supabaseAdmin
    .from('search_configs')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // A config is "PhD" iff its sources include 'phd'. Filter accordingly.
  const filtered = (data ?? []).filter((c) => {
    const isPhd = Array.isArray(c.sources) && c.sources.includes('phd')
    if (scope === 'jobs') return !isPhd
    if (scope === 'phd')  return isPhd
    return true
  })

  return NextResponse.json(filtered)
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    name,
    keywords         = [],
    target_companies = [],
    locations        = ['United States'],
    sources          = ['linkedin', 'indeed', 'google'],
    career_page_urls = [],
    schedule_interval = 'daily',
  } = body

  if (!keywords.length) {
    return NextResponse.json({ error: 'At least one keyword is required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('search_configs')
    .insert({
      user_id:           session.user.id,
      name:              name ?? null,
      keywords,
      target_companies,
      locations,
      sources,
      career_page_urls,
      schedule_interval,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { id, ...rest } = body as Record<string, unknown> & { id?: string }
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Whitelist editable fields — prevents clients from overriding user_id, id, timestamps, etc.
  const ALLOWED = [
    'name', 'keywords', 'target_companies', 'locations',
    'sources', 'career_page_urls', 'schedule_interval',
  ] as const
  const patch: Record<string, unknown> = Object.fromEntries(
    Object.entries(rest).filter(([k]) => (ALLOWED as readonly string[]).includes(k))
  )

  if (Array.isArray(patch.keywords) && patch.keywords.length === 0) {
    return NextResponse.json({ error: 'At least one keyword is required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('search_configs')
    .update(patch)
    .eq('id', id)
    .eq('user_id', session.user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Config not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Soft-delete: flip is_active to false
  const { error } = await supabaseAdmin
    .from('search_configs')
    .update({ is_active: false })
    .eq('id', id)
    .eq('user_id', session.user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
