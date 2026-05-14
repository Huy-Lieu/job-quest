// app/api/workday-registry/route.ts
// GET    — return all entries: KNOWN_WORKDAY (built-in) + user's DB entries
// POST   — add a new user entry to the workday_registry table
// DELETE — remove a user entry from the workday_registry table

import { NextResponse }    from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { supabaseAdmin }    from '@/lib/supabase'
import { KNOWN_WORKDAY }    from '@/lib/apify/ats-resolver'

// ─── GET — list built-in + user registry entries ──────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const builtIn = Object.entries(KNOWN_WORKDAY)
    .map(([key, t]) => ({ key, tenant: t.tenant, dc: t.dc, site: t.site, source: 'built-in' as const }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (supabaseAdmin as any)
    .from('workday_registry')
    .select('key, tenant, dc, site')
    .eq('user_id', session.user.id)
    .order('key') as { data: { key: string; tenant: string; dc: string; site: string }[] | null; error: unknown }

  if (error) {
    console.error('[workday-registry] GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch registry' }, { status: 500 })
  }

  const userEntries = (rows ?? []).map(r => ({ ...r, source: 'user' as const }))

  const merged = new Map<string, object>()
  for (const e of builtIn)     merged.set(e.key, e)
  for (const e of userEntries) merged.set(e.key, e)

  const entries = [...merged.values()].sort((a, b) =>
    (a as { key: string }).key.localeCompare((b as { key: string }).key)
  )

  return NextResponse.json(entries)
}

// ─── POST — add a new user entry ─────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  let { key, tenant, dc, site, url } = body as {
    key?: string; tenant?: string; dc?: string; site?: string; url?: string
  }

  if (url) {
    const m = url.trim().match(
      /https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:en-US\/|wday\/cxs\/[^/]+\/)?([^/?#]+)/i
    )
    if (!m) {
      return NextResponse.json(
        { error: 'Could not parse Workday URL — expected format: https://{tenant}.{dc}.myworkdayjobs.com/{site}' },
        { status: 400 }
      )
    }
    tenant = m[1]; dc = m[2]; site = m[3]
    if (!key) key = tenant
  }

  if (!key || !tenant || !dc || !site) {
    return NextResponse.json(
      { error: 'key, tenant, dc, and site are all required (or provide a url)' },
      { status: 400 }
    )
  }

  const normalKey = key.toLowerCase().trim().replace(/\s+/g, '')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabaseAdmin as any)
    .from('workday_registry')
    .insert({ user_id: session.user.id, key: normalKey, tenant, dc, site })

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: `"${normalKey}" already exists in your registry` }, { status: 409 })
    }
    console.error('[workday-registry] POST failed:', error)
    return NextResponse.json({ error: 'Failed to save entry' }, { status: 500 })
  }

  return NextResponse.json({ key: normalKey, tenant, dc, site }, { status: 201 })
}

// ─── DELETE — remove a user entry by key ─────────────────────────────────────

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 })

  const normalKey = key.toLowerCase().trim().replace(/\s+/g, '')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error, count } = await (supabaseAdmin as any)
    .from('workday_registry')
    .delete({ count: 'exact' })
    .eq('user_id', session.user.id)
    .eq('key', normalKey) as { error: unknown; count: number | null }

  if (error) {
    console.error('[workday-registry] DELETE failed:', error)
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 })
  }

  if (!count || count === 0) {
    return NextResponse.json({ error: `"${normalKey}" not found in your registry` }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
