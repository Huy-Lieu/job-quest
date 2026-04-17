import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(request: Request) {
  try {
    const { username, password, fullName, email } = await request.json()

    // Basic validation
    if (!username || !password || !fullName) {
      return NextResponse.json(
        { error: 'Username, password, and full name are required' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    // Check if username already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('username', username)
      .single()

    if (existingUser) {
      return NextResponse.json(
        { error: 'Username is already taken' },
        { status: 409 }
      )
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 12)

    // Insert new user into Supabase
    const { data: newUser, error } = await supabaseAdmin
      .from('users')
      .insert({
        username,
        email: email || null,
        password_hash: passwordHash,
        name: fullName,
      })
      .select('id, username, name')
      .single()

    if (error) {
      console.error('Supabase insert error:', error)
      return NextResponse.json(
        { error: 'Failed to create account. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { message: 'Account created successfully', user: newUser },
      { status: 201 }
    )
  } catch (error) {
    console.error('Register route error:', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
