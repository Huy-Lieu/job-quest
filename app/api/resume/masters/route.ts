import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { extractTextFromFile } from '@/lib/resume'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('resume_versions')
    .select('*')
    .eq('user_id', session.user.id)
    .in('type', ['master', 'variant'])
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let variant_name = ''
  let content = ''
  let make_default = false
  let type = 'master'

  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    variant_name = (formData.get('variant_name') as string) ?? ''
    make_default = formData.get('make_default') === 'true'
    type = (formData.get('type') as string) ?? 'master'

    const file = formData.get('file') as File | null
    const pastedContent = (formData.get('content') as string) ?? ''

    if (file && file.size > 0) {
      try {
        content = await extractTextFromFile(file)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to extract text from file'
        return NextResponse.json({ error: msg }, { status: 400 })
      }
    } else {
      content = pastedContent
    }
  } else {
    const body = await request.json()
    variant_name = body.variant_name
    content = body.content
    make_default = body.make_default ?? false
    type = body.type ?? 'master'
  }

  if (!variant_name || !content?.trim()) {
    return NextResponse.json({ error: 'Name and content are required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('resume_versions')
    .insert({
      user_id: session.user.id,
      type,
      variant_name,
      content,
      is_default: make_default ?? false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (make_default) {
    await supabaseAdmin
      .from('resume_versions')
      .update({ is_default: false })
      .eq('user_id', session.user.id)
      .neq('id', data.id)
  }

  return NextResponse.json(data, { status: 201 })
}
