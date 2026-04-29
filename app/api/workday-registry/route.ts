// app/api/workday-registry/route.ts
// GET    — return all entries in KNOWN_WORKDAY as a sorted array
// POST   — add a new entry (by URL parse or manual fields), writes to ats-resolver.ts
// DELETE — remove an entry by key, writes to ats-resolver.ts

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { KNOWN_WORKDAY } from '@/lib/apify/ats-resolver'
import fs from 'fs'
import path from 'path'

const RESOLVER_PATH = path.join(process.cwd(), 'lib', 'apify', 'ats-resolver.ts')

// ─── GET — list all registry entries ─────────────────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entries = Object.entries(KNOWN_WORKDAY)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, t]) => ({ key, tenant: t.tenant, dc: t.dc, site: t.site }))

  return NextResponse.json(entries)
}

// ─── POST — add a new entry ───────────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  let { key, tenant, dc, site, url } = body as {
    key?: string; tenant?: string; dc?: string; site?: string; url?: string
  }

  // If a URL was provided, parse tenant/dc/site from it
  if (url) {
    const m = url.trim().match(
      /https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:en-US\/|wday\/cxs\/[^/]+\/)?([^/?#]+)/i
    )
    if (!m) return NextResponse.json({ error: 'Could not parse Workday URL — expected format: https://{tenant}.{dc}.myworkdayjobs.com/{site}' }, { status: 400 })
    tenant = m[1]; dc = m[2]; site = m[3]
    if (!key) key = tenant
  }

  if (!key || !tenant || !dc || !site) {
    return NextResponse.json({ error: 'key, tenant, dc, and site are all required (or provide a url)' }, { status: 400 })
  }

  const normalKey = key.toLowerCase().trim().replace(/\s+/g, '')

  if (KNOWN_WORKDAY[normalKey]) {
    return NextResponse.json({ error: `"${normalKey}" already exists in the registry` }, { status: 409 })
  }

  // Write to ats-resolver.ts — insert new line inside KNOWN_WORKDAY object
  try {
    const src = fs.readFileSync(RESOLVER_PATH, 'utf8')
    // Find the closing brace of KNOWN_WORKDAY
    const marker = '\n}'
    const insertBefore = src.lastIndexOf(marker + '\n\nexport function resolveWorkdayTenants')
    if (insertBefore === -1) {
      return NextResponse.json({ error: 'Could not locate insertion point in ats-resolver.ts' }, { status: 500 })
    }
    const newLine = `  '${normalKey}': { tenant: '${tenant}', dc: '${dc}', site: '${site}' },`
    const updated = src.slice(0, insertBefore) + '\n' + newLine + src.slice(insertBefore)
    fs.writeFileSync(RESOLVER_PATH, updated, 'utf8')
  } catch (err) {
    return NextResponse.json({ error: `File write failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }

  return NextResponse.json({ key: normalKey, tenant, dc, site }, { status: 201 })
}

// ─── DELETE — remove an entry by key ─────────────────────────────────────────

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 })

  const normalKey = key.toLowerCase().trim().replace(/\s+/g, '')

  if (!KNOWN_WORKDAY[normalKey]) {
    return NextResponse.json({ error: `"${normalKey}" not found in registry` }, { status: 404 })
  }

  try {
    const src = fs.readFileSync(RESOLVER_PATH, 'utf8')
    // Remove the line that contains the key — match with single or double quotes
    const lineRegex = new RegExp(`^  ['"]${normalKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]:\\s*\\{[^}]+\\},?\\n`, 'm')
    const updated = src.replace(lineRegex, '')
    if (updated === src) {
      return NextResponse.json({ error: 'Could not locate entry line in ats-resolver.ts' }, { status: 500 })
    }
    fs.writeFileSync(RESOLVER_PATH, updated, 'utf8')
  } catch (err) {
    return NextResponse.json({ error: `File write failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
