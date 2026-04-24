import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import bcrypt from 'bcryptjs'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('name, email, username')
    .eq('id', session.user.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { name, email, currentPassword, newPassword } = body

  // Handle profile update (name / email)
  if (name !== undefined || email !== undefined) {
    const updates: Record<string, string> = {}
    if (name !== undefined) updates.name = name
    if (email !== undefined) updates.email = email

    const { error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', session.user.id)

    if (error) {
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
    }
  }

  // Handle password change
  if (currentPassword && newPassword) {
    const { data: user, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('password_hash')
      .eq('id', session.user.id)
      .single()

    if (fetchError || !user) {
      return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 })
    }

    const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash)
    if (!passwordMatch) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    const newHash = await bcrypt.hash(newPassword, 12)
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ password_hash: newHash })
      .eq('id', session.user.id)

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update password' }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}
