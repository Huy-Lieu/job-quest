// lib/apify/specialty-boards.ts
// Specialty job board scrapers via Apify and custom APIs.
// Includes: Glassdoor, Wellfound, ZipRecruiter, ClearanceJobs, YC/WAAS, HN, Personio, Teamtailor

import { runApifyActor } from './search'

// ─────────────────────────────────────────────────────────────────────────────
// Glassdoor jobs (Apify)
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeGlassdoor(query: string, maxItems = 20): Promise<Record<string, unknown>[]> {
  return runApifyActor('bebity/glassdoor-jobs-scraper', {
    keyword:  query,
    location: 'United States',
    maxItems,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Wellfound (AngelList Talent) — structured actor (clearpath/wellfound-api-ppe).
// Pricing: $3.49 per 1,000 jobs (pay-per-result).
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeWellfound(query: string, pageLimit = 3): Promise<Record<string, unknown>[]> {
  const slug = query.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!slug) return []
  const raw = await runApifyActor('clearpath/wellfound-api-ppe', {
    urls:           [`https://wellfound.com/role/r/${slug}`],
    pageLimit,
    onlyRemoteJobs: false,
    sortBy:         'LAST_POSTED',
    monitorMode:    false,
  })
  return (raw as Array<Record<string, unknown>>).map((j) => {
    const locs = j.location_names
    const location = Array.isArray(locs) && locs.length > 0 ? String(locs[0]) : 'Unknown'
    return {
      title:       j.title,
      company:     j.company_name,
      location,
      url:         j.url,
      salary:      j.compensation ?? j.base_salary,
      description: j.description ?? '',
      postedAt:    j.live_start_at_readable,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// ZipRecruiter (Apify) — fatihtahta/ziprecruiter-scraper, pay-per-use ($2.49/1k jobs)
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeZipRecruiter(query: string, limit = 20): Promise<Record<string, unknown>[]> {
  return runApifyActor('fatihtahta/ziprecruiter-scraper', {
    queries:  [query],
    location: 'United States',
    days:     '10',
    limit,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// ClearanceJobs — via Apify rag-web-browser with site: filter (no dedicated actor)
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeClearanceJobs(query: string, maxResults = 15): Promise<Record<string, unknown>[]> {
  return runApifyActor('apify/rag-web-browser', {
    query: `site:clearancejobs.com ${query}`,
    maxResults,
    outputFormats: ['markdown'],
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// YC Work at a Startup — Apify rag-web-browser with site: filter
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeYcWaas(query: string, maxResults = 10): Promise<Record<string, unknown>[]> {
  return runApifyActor('apify/rag-web-browser', {
    query: `site:workatastartup.com ${query}`,
    maxResults,
    outputFormats: ['markdown'],
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// HN "Who is Hiring" — Algolia search + HN Firebase item API
// ─────────────────────────────────────────────────────────────────────────────

interface HNItem {
  id?:      number
  text?:    string
  kids?:    number[]
  by?:      string
  time?:    number
  dead?:    boolean
  deleted?: boolean
}

/** Find newest "Ask HN: Who is hiring?" thread and return comments matching any keyword. */
export async function fetchHNWhoIsHiring(keywords: string[]): Promise<Record<string, unknown>[]> {
  try {
    const search = await fetch(
      'https://hn.algolia.com/api/v1/search?query=Ask+HN+Who+is+hiring&tags=story&hitsPerPage=3'
    )
    if (!search.ok) return []
    const { hits } = await search.json() as { hits: Array<{ objectID: string; title?: string; created_at_i?: number }> }
    const hiring = hits
      .filter((h) => /who is hiring/i.test(h.title ?? ''))
      .sort((a, b) => (b.created_at_i ?? 0) - (a.created_at_i ?? 0))[0]
    if (!hiring) return []

    const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${hiring.objectID}.json`)
    const story = await storyRes.json() as HNItem
    const kidIds = (story.kids ?? []).slice(0, 200) // cap to keep request count sane

    const kids = await Promise.allSettled(
      kidIds.map((id) => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then((r) => r.json() as Promise<HNItem>))
    )
    const comments = kids
      .filter((r): r is PromiseFulfilledResult<HNItem> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((c) => c && !c.dead && !c.deleted && c.text)

    const kwRe = keywords.length
      ? new RegExp(keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
      : null

    return comments
      .filter((c) => !kwRe || (c.text && kwRe.test(c.text)))
      .map((c) => {
        const text = (c.text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        const firstLine = text.split(/[.\n|·|•]/)[0]?.trim() ?? ''
        const companyMatch = firstLine.match(/^([A-Z][A-Za-z0-9&.\- ]{1,40})(?:\s*[|\-–—]|\s+is\b|\s+\()/)
        const company = companyMatch?.[1]?.trim() || firstLine.slice(0, 40)
        return {
          title:         firstLine.slice(0, 200) || `HN Hiring post ${c.id}`,
          company,
          location:      'Unknown',
          url:           `https://news.ycombinator.com/item?id=${c.id}`,
          description:   text.slice(0, 2000),
          postedAt:      c.time ? new Date(c.time * 1000).toISOString() : null,
          source_job_id: String(c.id ?? ''),
        }
      })
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Personio — XML feed at {slug}.jobs.personio.de/xml
// ─────────────────────────────────────────────────────────────────────────────

function xmlTag(block: string, tag: string): string {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'))
  if (!m) return ''
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

export async function fetchPersonioBoard(slug: string): Promise<Record<string, unknown>[]> {
  try {
    let res = await fetch('https://' + slug + '.jobs.personio.de/xml', { headers: { Accept: 'application/xml' } })
    if (!res.ok) {
      res = await fetch('https://' + slug + '.jobs.personio.com/xml', { headers: { Accept: 'application/xml' } })
    }
    if (!res.ok) return []
    const xml = await res.text()
    const positions = xml.match(/<position[\s\S]*?<\/position>/gi) ?? []
    return positions.map((block) => {
      const id          = xmlTag(block, 'id')
      const title       = xmlTag(block, 'name')
      const office      = xmlTag(block, 'office')
      const department  = xmlTag(block, 'department')
      const description = xmlTag(block, 'jobDescriptions') || xmlTag(block, 'description')
      const employment  = xmlTag(block, 'employmentType')
      const schedule    = xmlTag(block, 'schedule')
      const createdAt   = xmlTag(block, 'createdAt')
      return {
        title,
        company:        slug,
        location:       office || 'Unknown',
        url:            id ? 'https://' + slug + '.jobs.personio.de/job/' + id : '',
        description:    (department ? department + '\n\n' : '') + description,
        employmentType: employment || schedule,
        postedAt:       createdAt || null,
        source_job_id:  id || null,
      }
    })
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Teamtailor — {slug}.teamtailor.com/jobs.json
// ─────────────────────────────────────────────────────────────────────────────

interface TeamtailorJob {
  id?:          string | number
  title?:       string
  body?:        string
  careersite_url?: string
  apply_url?:   string
  locations?:   Array<{ name?: string }>
  employment_type?: string
  remote_status?: string
  published_at?: string
}

export async function fetchTeamtailorBoard(slug: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(
      'https://' + slug + '.teamtailor.com/jobs.json',
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return []
    const body = await res.json()
    const jobs = (Array.isArray(body) ? body : body.jobs ?? []) as TeamtailorJob[]
    return jobs.map((j) => ({
      title:          j.title ?? '',
      company:        slug,
      location:       j.locations?.map((l) => l.name).filter(Boolean).join(', ') || 'Unknown',
      url:            j.apply_url ?? j.careersite_url ?? '',
      description:    j.body ?? '',
      employmentType: j.employment_type,
      workplaceType:  j.remote_status === 'fully' ? 'remote' : undefined,
      postedAt:       j.published_at ?? null,
      source_job_id:  j.id != null ? String(j.id) : null,
    }))
  } catch {
    return []
  }
}
