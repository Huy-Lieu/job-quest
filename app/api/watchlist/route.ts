import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('professor_watchlists')
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[watchlist GET] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch watchlist' }, { status: 500 })
  }

  return NextResponse.json(data || [])
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { name, institution, research_area, profile_url, notes } = body

  // Validate required fields
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Name is required and must be a non-empty string' }, { status: 400 })
  }

  if (!institution || typeof institution !== 'string' || !institution.trim()) {
    return NextResponse.json({ error: 'Institution is required and must be a non-empty string' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('professor_watchlists')
    .insert({
      user_id: session.user.id,
      name: name.trim(),
      institution: institution.trim(),
      research_area: research_area ? String(research_area).trim() : null,
      profile_url: profile_url ? String(profile_url).trim() : null,
      notes: notes ? String(notes).trim() : null,
    })
    .select()
    .single()

  if (error) {
    console.error('[watchlist POST] Error:', error)
    return NextResponse.json({ error: 'Failed to create watchlist entry' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
