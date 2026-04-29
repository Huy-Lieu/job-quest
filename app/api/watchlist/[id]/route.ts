import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  // Verify ownership
  const { data: entry, error: fetchError } = await supabaseAdmin
    .from('professor_watchlists')
    .select('id, user_id')
    .eq('id', id)
    .single()

  if (fetchError || !entry) {
    return NextResponse.json({ error: 'Watchlist entry not found' }, { status: 404 })
  }

  if (entry.user_id !== session.user.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  // Delete
  const { error: deleteError } = await supabaseAdmin
    .from('professor_watchlists')
    .delete()
    .eq('id', id)

  if (deleteError) {
    console.error('[watchlist DELETE] Error:', deleteError)
    return NextResponse.json({ error: 'Failed to delete watchlist entry' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json()
  const { research_area, profile_url, notes } = body

  // Verify ownership
  const { data: entry, error: fetchError } = await supabaseAdmin
    .from('professor_watchlists')
    .select('id, user_id')
    .eq('id', id)
    .single()

  if (fetchError || !entry) {
    return NextResponse.json({ error: 'Watchlist entry not found' }, { status: 404 })
  }

  if (entry.user_id !== session.user.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  // Update only mutable fields
  const updateData: Record<string, unknown> = {}
  if (research_area !== undefined) {
    updateData.research_area = research_area ? String(research_area).trim() : null
  }
  if (profile_url !== undefined) {
    updateData.profile_url = profile_url ? String(profile_url).trim() : null
  }
  if (notes !== undefined) {
    updateData.notes = notes ? String(notes).trim() : null
  }

  const { data, error } = await supabaseAdmin
    .from('professor_watchlists')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[watchlist PATCH] Error:', error)
    return NextResponse.json({ error: 'Failed to update watchlist entry' }, { status: 500 })
  }

  return NextResponse.json(data)
}
