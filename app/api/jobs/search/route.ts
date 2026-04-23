// app/api/jobs/search/route.ts
// DEPRECATED — replaced by POST /api/search/run + GET /api/jobs
// This file is kept as a redirect shim for any clients that still call the old endpoint.

import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json(
    {
      error:   'This endpoint has been replaced.',
      message: 'Use POST /api/search/run to trigger a search, then GET /api/jobs to fetch results.',
    },
    { status: 410 } // 410 Gone
  )
}
