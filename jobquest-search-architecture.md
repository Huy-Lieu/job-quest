# JobQuest — Job Search Engine Architecture
**Version:** 2.0 | **Stack:** Next.js · Supabase · Claude API · Apify API · SerpAPI  
**Scope:** Full search pipeline — sources → scrape → normalize → enrich → deduplicate → score → store → stream → display

---

## 1. System Overview

JobQuest's job search engine uses a **dual-source acquisition layer** feeding a **5-stage intelligence pipeline**:

- **Apify** — deep scraper. Handles LinkedIn, Indeed, Greenhouse, Lever, Ashby, Workday, and company career pages. Bypasses anti-bot, parses ATS pages.
- **SerpAPI** — broad net. Google Jobs aggregation via `google_jobs` engine. Catches listings Apify sources miss. Complementary, not competing.
- **Claude Haiku** — enrichment pass. Reads raw job text and extracts every structured field. Runs after normalization, before deduplication.
- **Claude Haiku** — deduplication. Cheap YES/NO fuzzy match on ambiguous pairs. Used only as Stage 3 last resort.
- **Claude Sonnet** — scoring. Batched fit analysis (5 jobs/call) against the user's active resume.

The pipeline runs in two modes:
- **Scheduled** — Vercel Cron triggers at 07:00 UTC daily for each active search config
- **On-demand** — user clicks "Search Now" in the UI; progress streamed back via SSE

Search timeout: **5 minutes** (`maxDuration = 300` on the SSE route). During search, the frontend polls `search_runs.progress` every 2 seconds and displays live stage updates.

---

## 2. Data Sources

### 2.1 Apify Sources

| Source | Apify Actor | Scope | Freshness |
|---|---|---|---|
| LinkedIn Jobs | `curious_coder/linkedin-jobs-scraper` | Title + company filters | Near real-time |
| Indeed | `misceres/indeed-scraper` | Keywords + location | Near real-time |
| Company career pages | `apify/website-content-crawler` | Watchlist URLs | Daily |
| Greenhouse/Lever/Ashby ATS | `apify/rag-web-browser` (targeted) | ATS-hosted job pages | Daily |
| Workday portals | `apify/rag-web-browser` (targeted) | Workday-hosted career pages | Daily |
| PhD/academic boards | `apify/rag-web-browser` | NSF, academicjobsonline.org | Daily |

### 2.2 SerpAPI Source

| Source | Engine | Scope | Freshness |
|---|---|---|---|
| Google Jobs | `google_jobs` engine | Broad keyword + location aggregation | Real-time |

SerpAPI `google_jobs` returns structured job data (title, company, location, description snippet, apply link, posted date) without requiring a browser. It aggregates across LinkedIn, Indeed, Glassdoor, and direct career pages — catching listings that Apify's individual actor scrapers may miss.

**SerpAPI call pattern:**
```javascript
// lib/serp/search.ts
const SERPAPI_KEY = process.env.SERPAPI_KEY;

export async function searchGoogleJobs(query: string, location = 'United States', daysAgo = 7) {
  const params = new URLSearchParams({
    engine: 'google_jobs',
    q: query,
    location,
    chips: `date_posted:${daysAgo === 1 ? 'today' : daysAgo <= 7 ? 'week' : 'month'}`,
    api_key: SERPAPI_KEY!,
  });
  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  const data = await res.json();
  return data.jobs_results ?? [];
}
```

### 2.3 Watchlist Companies (initial seed)

Industry: NVIDIA, Qualcomm, Intel, AMD, Texas Instruments, Broadcom, Marvell, Arm  
Automotive/ADAS: Applied Intuition, Aurora, Waymo, Bosch, Continental  
PhD boards: NSF REU, academicjobsonline.org, scholarshipdb.net

---

## 3. Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         TRIGGER LAYER                           │
│   Vercel Cron (07:00 UTC daily)  |  /api/search/stream (SSE)    │
└────────────────────────┬────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│                       ORCHESTRATOR                              │
│  Reads user SearchConfig · Creates search_runs row              │
│  Emits SSE: { stage: "scraping", progress: 0 }                  │
└──────┬──────┬──────┬──────┬──────┬──────┬───────────────────────┘
       ↓      ↓      ↓      ↓      ↓      ↓
  SerpAPI  LinkedIn  Indeed  Career  ATS   PhD
  Google             Pages   Pages  Boards
  Jobs    [ALL FIRED IN PARALLEL — Promise.allSettled]
       ↓      ↓      ↓      ↓      ↓      ↓
┌─────────────────────────────────────────────────────────────────┐
│                    NORMALIZATION LAYER                          │
│  Raw JSON → canonical Job schema (basic fields only)            │
│  Extract: title · company · location · salary · URL · date      │
│  Emits SSE: { stage: "normalizing", found: N }                  │
└─────────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│                  HAIKU ENRICHMENT LAYER  ← NEW                  │
│  Model: claude-haiku-4-5 · Batched: 10 jobs/call                │
│  Input:  raw description text                                   │
│  Output: role_summary · skills_required · skills_preferred      │
│          tech_stack · work_mode · visa_sponsorship · apply_url  │
│          experience_years · education_level · benefits          │
│          security_clearance · languages_required                │
│  Emits SSE: { stage: "enriching", enriched: N }                 │
└─────────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│                   DEDUPLICATION LAYER                           │
│  Stage 1: Source job ID match (exact — fastest)                 │
│  Stage 2: SHA-256 hash (company + title + location)             │
│  Stage 3: Claude Haiku YES/NO (ambiguous same-company pairs)    │
│  → Merge into canonical job · track all source URLs             │
│  → Increment sources_count on merge                             │
│  Emits SSE: { stage: "deduplicating", unique: N }               │
└─────────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│                    CLAUDE SCORING LAYER                         │
│  Model: claude-sonnet-4-6 · Batched: 5 jobs/call               │
│  Input:  enriched job + user's active resume text               │
│  Output: fit_score (0–100) · skills_matched · skills_missing    │
│          fit_reason (2–3 sentences) · recommended (bool)        │
│  Emits SSE: { stage: "scoring", scored: N }                     │
└─────────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│                     SUPABASE STORAGE                            │
│  jobs · job_sources · job_scores · search_runs                  │
│  company_intel (cached) · analysis_sessions                     │
│  Emits SSE: { stage: "complete", newJobs: N, scored: N }        │
└─────────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│                     NEXT.JS FRONTEND                            │
│  Split-pane job board · SSE progress bar · Score badges         │
│  [Job Details tab] · [Company Intel tab] · Apply links          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Supabase Schema

### 4.1 `jobs` — canonical deduplicated listings

```sql
CREATE TABLE jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_title       text NOT NULL,
  company               text NOT NULL,
  location              text,
  description           text,            -- raw full text from scraper
  salary_min            integer,
  salary_max            integer,
  salary_currency       text DEFAULT 'USD',
  job_type              text,            -- full-time | contract | part-time | internship
  is_phd                boolean DEFAULT false,
  posted_at             timestamptz,
  scraped_at            timestamptz DEFAULT now(),
  expires_at            timestamptz,
  status                text DEFAULT 'active',  -- active | expired | filled
  raw_hash              text UNIQUE,     -- SHA-256(company+title+location) for dedup
  source                text DEFAULT 'scraped', -- scraped | manual | serp
  sources_count         integer DEFAULT 1,      -- how many sources found this job

  -- Haiku enrichment fields (populated after enrichment pass)
  role_summary          text,            -- 2-3 sentence plain-English summary
  skills_required       text[],          -- must-have skills from JD
  skills_preferred       text[],          -- nice-to-have skills from JD
  tech_stack            text[],          -- tools/languages/frameworks mentioned
  work_mode             text,            -- remote | hybrid | on-site | unknown
  visa_sponsorship      text DEFAULT 'unknown',  -- yes | no | unknown
  experience_years_min  integer,
  experience_years_max  integer,
  education_level       text,            -- bachelor | master | phd | none | unknown
  security_clearance    text DEFAULT 'none',   -- none | preferred | required
  benefits_highlights   text[],          -- e.g. ['401k match', 'RSUs', 'visa sponsorship']
  languages_required    text[],          -- e.g. ['English', 'German']
  apply_url             text,            -- direct application link (not job board link)
  enriched_at           timestamptz,     -- null = not yet enriched

  -- Company intel alignment (per-job, lightweight)
  role_alignment        text             -- 1-2 sentences on how role fits company direction
);
```

### 4.2 `job_sources` — one row per platform this job appeared on

```sql
CREATE TABLE job_sources (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid REFERENCES jobs(id) ON DELETE CASCADE,
  source_name    text NOT NULL,   -- linkedin | indeed | google | greenhouse | lever | ashby
                                  -- workday | career_page | phd | serp | manual
  source_url     text NOT NULL,
  source_job_id  text,            -- external ID extracted from URL
  scraped_at     timestamptz DEFAULT now(),
  UNIQUE(source_name, source_job_id)
);
```

### 4.3 `job_scores` — Claude Sonnet fit analysis per user

```sql
CREATE TABLE job_scores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid REFERENCES jobs(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id),
  fit_score       integer CHECK (fit_score BETWEEN 0 AND 100),
  fit_reason      text,           -- Claude's 2-3 sentence explanation
  skills_matched  text[],         -- e.g. ['UDS', 'AUTOSAR', 'Python']
  skills_missing  text[],         -- e.g. ['SystemVerilog', 'UVM']
  recommended     boolean,
  scored_at       timestamptz DEFAULT now(),
  UNIQUE(job_id, user_id)
);
```

### 4.4 `resumes` — parsed user resumes

```sql
CREATE TABLE resumes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES users(id),
  raw_text          text NOT NULL,
  parsed_skills     text[],
  parsed_experience jsonb,         -- [{company, title, duration, bullets[]}]
  parsed_education  jsonb,         -- [{school, degree, field, gpa, year}]
  is_active         boolean DEFAULT true,
  created_at        timestamptz DEFAULT now()
);
```

### 4.5 `search_configs` — user's saved search profiles

```sql
CREATE TABLE search_configs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES users(id),
  name              text,          -- e.g. "Hardware verification roles"
  keywords          text[],        -- e.g. ['embedded', 'hardware verification']
  target_companies  text[],        -- e.g. ['NVIDIA', 'Qualcomm']
  locations         text[],        -- e.g. ['USA', 'Remote']
  sources           text[],        -- which sources to enable
  schedule_interval text DEFAULT 'daily',  -- daily | 6h | manual
  last_run_at       timestamptz,
  is_active         boolean DEFAULT true,
  serp_enabled      boolean DEFAULT true,  -- toggle SerpAPI on/off (250 searches/month quota)
  serp_next_offset  integer DEFAULT 0,     -- pagination cursor; advances by 10 each run, resets to 0
  created_at        timestamptz DEFAULT now()
);
```

### 4.6 `search_runs` — audit log + SSE progress state

```sql
CREATE TABLE search_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users(id),
  config_id     uuid REFERENCES search_configs(id),
  started_at    timestamptz DEFAULT now(),
  completed_at  timestamptz,
  jobs_found    integer DEFAULT 0,
  jobs_new      integer DEFAULT 0,
  jobs_enriched integer DEFAULT 0,
  jobs_scored   integer DEFAULT 0,
  status        text DEFAULT 'running',  -- running | complete | failed
  error_text    text,
  apify_run_ids jsonb,                   -- {linkedin: 'runId1', indeed: 'runId2', ...}
  progress      jsonb DEFAULT '{}'       -- SSE polling state: {stage, found, enriched, scored}
);
```

### 4.7 `company_intel` — cached company intelligence (7-day TTL)

```sql
CREATE TABLE company_intel (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name        text NOT NULL UNIQUE,
  summary             text,          -- what the company does
  recent_news         jsonb,         -- [{headline, date, url, summary}]
  strategic_direction text,          -- current goals, product bets, hiring signals
  hiring_signals      text,          -- are they growing? layoffs? new office?
  red_flags           text,          -- glassdoor concerns, controversy, instability
  fetched_at          timestamptz DEFAULT now(),
  expires_at          timestamptz DEFAULT now() + interval '7 days'
);
```

Multiple jobs from the same company share one cached `company_intel` row. On first click for a company, intel is fetched and cached. All subsequent jobs from the same company serve instantly from cache until TTL expires.

### 4.8 `analysis_sessions` — deep analysis state per job+resume

```sql
CREATE TABLE analysis_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES users(id),
  job_id                uuid REFERENCES jobs(id),   -- nullable for manual paste
  resume_id             uuid REFERENCES resume_versions(id),
  raw_jd_text           text,         -- populated when job_id is null (manual paste)
  manual_company        text,         -- populated when job_id is null
  gap_analysis          text,
  interview_prep        text,
  cover_letter          text,
  conservative_resume_id uuid,
  aggressive_resume_id  uuid,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  UNIQUE(job_id, resume_id)
);
```

### 4.9 Database Migration (run once, fresh start)

```sql
-- Step 1: Clean existing job data (keep users, applications, resumes, achievements)
TRUNCATE job_scores CASCADE;
TRUNCATE job_sources CASCADE;
TRUNCATE search_runs CASCADE;
TRUNCATE jobs CASCADE;

-- Step 2: Add new columns to jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS role_summary text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skills_required text[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skills_preferred text[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tech_stack text[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_mode text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS visa_sponsorship text DEFAULT 'unknown';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS experience_years_min integer;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS experience_years_max integer;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS education_level text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS security_clearance text DEFAULT 'none'; -- none | preferred | required
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS benefits_highlights text[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS languages_required text[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_url text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS enriched_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS sources_count integer DEFAULT 1;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS role_alignment text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source text DEFAULT 'scraped';

-- Step 3: Add progress column to search_runs
ALTER TABLE search_runs ADD COLUMN IF NOT EXISTS jobs_enriched integer DEFAULT 0;
ALTER TABLE search_runs ADD COLUMN IF NOT EXISTS progress jsonb DEFAULT '{}';

-- Step 4: Create new tables
CREATE TABLE IF NOT EXISTS company_intel (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name        text NOT NULL UNIQUE,
  summary             text,
  recent_news         jsonb,
  strategic_direction text,
  hiring_signals      text,
  red_flags           text,
  fetched_at          timestamptz DEFAULT now(),
  expires_at          timestamptz DEFAULT now() + interval '7 days'
);

CREATE TABLE IF NOT EXISTS analysis_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid REFERENCES users(id),
  job_id                 uuid REFERENCES jobs(id),
  resume_id              uuid REFERENCES resume_versions(id),
  raw_jd_text            text,
  manual_company         text,
  gap_analysis           text,
  interview_prep         text,
  cover_letter           text,
  conservative_resume_id uuid,
  aggressive_resume_id   uuid,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  UNIQUE(job_id, resume_id)
);
```

---

## 5. Haiku Enrichment Layer (PROMPT-08)

This is the most important new stage. After normalization, every job's raw description is passed to Claude Haiku to extract structured fields. This replaces manual regex parsing and produces consistent, queryable data.

**Batch size:** 10 jobs per Haiku call. Description truncated at 3000 chars after boilerplate stripping (up from 1500 — apply URL, visa, and education info often appear in the second half of JDs). System prompt is prompt-cached across batches for cost savings. Falls back to per-job processing if a batch parse fails.

**Key design decisions in v2.1:**
- `"index"` field echoed back in each result for order validation — if model skips or reorders, sort by index before mapping back to input
- `security_clearance` is now `"none" | "preferred" | "required"` (not boolean) — distinguishes required clearance from preferred
- `role_summary` has explicit filler phrase ban — model briefed to write for a candidate with 10 seconds to decide
- `skills_required` vs `skills_preferred` classification uses section-header heuristic, not individual phrase detection
- `seniority_level` and `role_type` extracted in addition to base fields
- `salary_min` / `salary_max` / `salary_currency` extracted when explicitly stated

**System prompt (prompt-cached, stable across batches):**
```
You are an expert technical recruiter and job description analyst with deep knowledge of how job postings are written across industries, company sizes, and regions.

Your task is to extract structured, machine-readable fields from raw job description text. Your extractions will be used downstream to match candidates to roles and power ATS scoring — accuracy matters more than completeness. When in doubt, under-extract rather than over-extract.

Core extraction principles:
- Only extract what is explicitly stated. Do not infer, assume, or hallucinate fields from context.
- Descriptions may be truncated. Extract only from what is present.
- When a field cannot be determined confidently, use its default/unknown value — never omit a key.

Skills classification rules (most important):
- skills_required: ONLY if the JD uses — "required", "must have", "must-have", "you must", "X+ years of X", or skill appears under a section explicitly labelled "Requirements" or "Qualifications" with no softening hedge
- skills_preferred: everything else — "preferred", "nice to have", "a plus", "bonus", "ideally", "familiarity with", or listed under "Preferred" / "Bonus" / "Nice to Have" sections
- When a section mixes hard and soft requirements in the same bullet list, use the section header as the classifier
- Do not duplicate skills across both arrays

Output format: Return ONLY a valid JSON array. No markdown fences, no explanation, no preamble.
```

**User prompt schema (per batch):**
```typescript
// Description truncated to 3000 chars after boilerplate stripping
// Each job prefixed with [index] for order validation

For each job return:
{
  "index": 0,                                    // must match [N] prefix exactly
  "role_summary": "...",                         // 2-3 sentences: core technical responsibilities, scope, domain. No filler phrases.
  "skills_required": ["skill1", "skill2"],       // must-have only — explicit language required
  "skills_preferred": ["skill3", "skill4"],      // nice-to-have, preferred, bonus
  "tech_stack": ["Python", "AWS", "React"],      // tools/languages/platforms/frameworks only
  "work_mode": "remote|hybrid|on-site|unknown",
  "visa_sponsorship": "yes|no|unknown",
  "experience_years_min": 2,                     // null if not mentioned
  "experience_years_max": 5,                     // null if not mentioned
  "education_level": "bachelor|master|phd|none|unknown",
  "security_clearance": "none|preferred|required", // not boolean
  "benefits_highlights": ["401k match", "RSUs"], // notable perks only, max 5, skip generic (health/dental/vision)
  "languages_required": ["English"],             // spoken languages only, empty array if not stated
  "apply_url": "https://...",                    // direct application URL if found, else null
  "seniority_level": "intern|junior|mid|senior|staff|principal|manager|director|vp|unknown",
  "role_type": "individual_contributor|manager|hybrid|unknown",
  "salary_min": null,                            // integer, null if not stated
  "salary_max": null,                            // integer, null if not stated
  "salary_currency": null                        // ISO 4217 (USD/GBP/EUR), null if not stated
}
```

**Why Haiku for enrichment (not Sonnet)?**
- Enrichment is high-volume: every new job goes through it
- The task is extraction, not reasoning — Haiku handles it accurately
- Cost: Haiku is ~20× cheaper than Sonnet per token
- Speed: Haiku is faster, reducing overall pipeline latency

---

## 6. SerpAPI Integration

### 6.1 Pagination Strategy

Google Jobs results are paginated via the `start` offset parameter. Always firing `start=0` returns the same top-10 jobs every run — wasteful and defeats the purpose of daily scraping. Instead, each search config tracks its own cursor (`serp_next_offset`) and advances it by 10 after every successful run.

**Reset conditions (either triggers a reset to 0):**
1. `results.length < 10` — Google has returned fewer than a full page, meaning the result pool for this query is exhausted. Reliable signal post-2025 since Google now consistently enforces 10 results per page.
2. `serp_next_offset >= 50` — hard safety cap. Beyond `start=50`, Google Jobs result quality degrades noticeably (relevance drift, recycled listings). 5 cycles × 10 jobs = 50 unique results per cycle before reset.

**Reset cadence:** At daily cron frequency, the offset resets every 5 days. By then, enough new jobs have been posted that `start=0` will surface a meaningfully refreshed top-10.

```typescript
// lib/serp/search.ts
const SERPAPI_KEY    = process.env.SERPAPI_KEY;
const SERP_MAX_OFFSET = 50; // hard cap — quality degrades beyond this

export async function searchGoogleJobs(
  query: string,
  location = 'United States',
  daysAgo = 7,
  offset = 0,          // serp_next_offset from search_configs
): Promise<{ results: SerpJobResult[]; nextOffset: number }> {
  const chips = daysAgo === 1 ? 'date_posted:today'
              : daysAgo <= 7  ? 'date_posted:week'
              :                 'date_posted:month';

  const params = new URLSearchParams({
    engine:  'google_jobs',
    q:       query,
    location,
    chips,
    start:   String(offset),
    api_key: SERPAPI_KEY!,
  });

  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!res.ok) throw new Error(`SerpAPI error: ${res.status}`);
  const data = await res.json();
  const results: SerpJobResult[] = data.jobs_results ?? [];

  // Determine next offset — reset if pool exhausted or hard cap reached
  const nextOffset = (results.length < 10 || offset + 10 >= SERP_MAX_OFFSET)
    ? 0
    : offset + 10;

  return { results, nextOffset };
}

// After a successful run, persist the new offset back to search_configs:
// await supabaseAdmin
//   .from('search_configs')
//   .update({ serp_next_offset: nextOffset })
//   .eq('id', config.id);

// Normalize SerpAPI result to canonical schema
export function normalizeSerpJob(raw: SerpJobResult): NormalizedJob {
  return {
    canonical_title: raw.title,
    company:         raw.company_name,
    location:        raw.location,
    description:     raw.description,
    posted_at:       parseSerpDate(raw.detected_extensions?.posted_at),
    salary_min:      parseSalaryMin(raw.detected_extensions?.salary ?? ''),
    salary_max:      parseSalaryMax(raw.detected_extensions?.salary ?? ''),
    job_type:        raw.detected_extensions?.work_from_home ? 'remote' : 'unknown',
    source: {
      name:          'serp',
      url:           raw.related_links?.[0]?.link ?? raw.share_link ?? '',
      source_job_id: raw.job_id,
    }
  };
}
```

### 6.2 SerpAPI vs Apify — how they complement each other

| Dimension | Apify | SerpAPI |
|---|---|---|
| Coverage | Deep per-source (LinkedIn, Indeed, ATS pages) | Broad Google Jobs aggregation |
| Data richness | Full job description, structured ATS fields | Snippet + key metadata |
| Anti-bot | Built-in proxy + bypass | Not needed (Google API) |
| Cost model | Per compute unit (actor runs) | Per search query |
| Best for | ATS-specific roles, company career pages | Quick broad sweeps, catching stragglers |

Both run in parallel. After normalization, deduplication merges any overlapping results.

---

## 7. Normalization Layer

```typescript
// lib/pipeline/normalize.ts

export function normalizeJob(raw: RawJob, sourceName: string): NormalizedJob {
  return {
    canonical_title:  cleanTitle(raw.title || raw.jobTitle || ''),
    company:          cleanCompany(raw.company || raw.companyName || ''),
    location:         raw.location || raw.jobLocation || 'Unknown',
    description:      raw.description || raw.markdown || '',
    salary_min:       parseSalaryMin(raw.salary || raw.salaryRange || ''),
    salary_max:       parseSalaryMax(raw.salary || raw.salaryRange || ''),
    job_type:         normalizeJobType(raw.employmentType || ''),
    posted_at:        parsePostedDate(raw.postedAt || raw.datePosted || ''),
    is_phd:           detectPhD(raw.title, raw.description),
    source: {
      name:           sourceName,
      url:            raw.url || raw.jobUrl || raw.applyUrl || '',
      source_job_id:  extractJobId(raw.url || '', sourceName),
    }
  };
  // Note: enrichment fields (role_summary, skills_required, etc.) are populated
  // by the Haiku enrichment pass AFTER normalization.
}

function cleanTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').replace(/\(.*?remote.*?\)/gi, '').trim();
}

function detectPhD(title = '', description = ''): boolean {
  const text = (title + ' ' + description).toLowerCase();
  return /\bphd\b|\bdoctoral\b|\bpostdoc\b|\bfellowship\b|\bfunded position\b/.test(text);
}

function extractJobId(url: string, source: string): string | null {
  if (source === 'linkedin')   return url.match(/\/view\/.*?-(\d+)/)?.[1] ?? null;
  if (source === 'greenhouse') return url.match(/\/jobs\/(\d+)/)?.[1] ?? null;
  if (source === 'lever')      return url.match(/\/(\w{8}-\w{4}-.*)/)?.[1] ?? null;
  if (source === 'indeed')     return url.match(/jk=([a-f0-9]+)/)?.[1] ?? null;
  if (source === 'serp')       return url.match(/job_id=([^&]+)/)?.[1] ?? null;
  return null;
}
```

---

## 8. Deduplication Layer

Three-stage, fast-first. Claude only as last resort.

```typescript
// lib/pipeline/deduplicate.ts
import crypto from 'crypto';
import { supabase } from '../supabase';
import { claudeResolveDedup } from '../claude/dedup';

export async function deduplicateJobs(enrichedJobs: EnrichedJob[]) {
  const canonical: EnrichedJob[] = [];

  for (const job of enrichedJobs) {
    // Stage 1: Source job ID — same job on multiple platforms
    if (job.source.source_job_id) {
      const { data: existing } = await supabase
        .from('job_sources')
        .select('job_id')
        .eq('source_job_id', job.source.source_job_id)
        .eq('source_name', job.source.name)
        .single();

      if (existing) {
        await addSourceRecord(existing.job_id, job.source);
        await supabase.from('jobs')
          .update({ sources_count: supabase.rpc('increment', { x: 1 }) })
          .eq('id', existing.job_id);
        continue;
      }
    }

    // Stage 2: SHA-256 hash fingerprint
    const hash = sha256(`${job.company}|${job.canonical_title}|${job.location}`);
    const { data: hashMatch } = await supabase
      .from('jobs').select('id').eq('raw_hash', hash).single();

    if (hashMatch) {
      await addSourceRecord(hashMatch.id, job.source);
      await supabase.from('jobs')
        .update({ sources_count: supabase.rpc('increment', { x: 1 }) })
        .eq('id', hashMatch.id);
      continue;
    }

    // Stage 3: Claude Haiku fuzzy match (same company, similar title only)
    const suspected = await findSuspectedDuplicate(job);
    if (suspected) {
      const isSame = await claudeResolveDedup(job, suspected); // Haiku YES/NO
      if (isSame) {
        await addSourceRecord(suspected.id, job.source);
        continue;
      }
    }

    // Unique job
    canonical.push({ ...job, raw_hash: hash });
  }

  return canonical;
}

function sha256(str: string): string {
  return crypto.createHash('sha256').update(str.toLowerCase()).digest('hex');
}
```

---

## 9. Claude Scoring Layer

```typescript
// lib/claude/scorer.ts
export async function scoreJobsBatch(jobs: EnrichedJob[], resume: ResumeData) {
  const batches = chunkArray(jobs, 5);
  const allScores: ScoreResult[] = [];

  for (const batch of batches) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: `You are a technical recruiter evaluating job fit. Return ONLY valid JSON arrays.`,
      messages: [{
        role: 'user',
        content: `Score each job for this candidate. Return one JSON object per job in order.

CANDIDATE:
Skills: ${resume.parsed_skills?.join(', ')}
Experience: ${resume.parsed_experience?.map((e: any) => `${e.title} at ${e.company}`).join('; ')}
Education: ${resume.parsed_education?.[0]?.degree} in ${resume.parsed_education?.[0]?.field}

JOBS:
${batch.map((j, i) => `[${i}] ${j.canonical_title} at ${j.company}
Required: ${j.skills_required?.join(', ')}
Summary: ${j.role_summary}`).join('\n\n')}

Return:
[{ "fit_score": 0-100, "recommended": bool, "fit_reason": "2-3 sentences", "skills_matched": [], "skills_missing": [] }]`
      }]
    });

    allScores.push(...JSON.parse(response.content[0].text));
  }

  return allScores;
}
```

---

## 10. SSE Streaming Route

```typescript
// app/api/search/stream/route.ts
export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const configId = searchParams.get('configId');
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return new Response('Unauthorized', { status: 401 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: object) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        emit('progress', { stage: 'scraping', message: 'Scraping job sources...' });
        // ... run pipeline stages, emit progress at each stage ...
        // Stages: scraping → normalizing → enriching → deduplicating → scoring → complete
        emit('complete', { newJobs: N, scored: N });
      } catch (err) {
        emit('error', { message: (err as Error).message });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    }
  });
}
```

**Fallback for non-SSE clients:** Frontend polls `GET /api/search/runs/:id` every 2 seconds, reading `search_runs.progress` JSONB. The pipeline writes progress to this column at each stage. Both approaches work simultaneously.

---

## 11. Company Intel Flow

Company intelligence is fetched on demand (manual trigger or "auto for top matches" toggle), cached per company with 7-day TTL.

```typescript
// lib/context.ts — shared data assembler
export async function buildJobContext(jobId: string | null, userId: string, rawJdText?: string) {
  // Step 1: Load job data
  let job: Job | null = null;
  if (jobId) {
    const { data } = await supabase.from('jobs').select('*').eq('id', jobId).single();
    job = data;
    // If not yet enriched, run Haiku inline
    if (!job?.enriched_at) {
      const [enriched] = await enrichJobsBatch([job!]);
      await supabase.from('jobs').update({ ...enriched, enriched_at: new Date() }).eq('id', jobId);
      job = { ...job!, ...enriched };
    }
  } else if (rawJdText) {
    // Manual paste: parse with Haiku into temp object (not stored yet)
    const [enriched] = await enrichJobsBatch([{ description: rawJdText } as any]);
    job = { ...enriched } as any;
  }

  // Step 2: Load or compute fit score
  const { data: existingScore } = await supabase
    .from('job_scores').select('*').eq('job_id', jobId).eq('user_id', userId).single();
  const score = existingScore ?? await scoreAndStore(job!, userId);

  // Step 3: Load or fetch company intel
  const { data: intel } = await supabase
    .from('company_intel')
    .select('*')
    .eq('company_name', job?.company)
    .gt('expires_at', new Date().toISOString())
    .single();
  // If null, caller triggers fetch — not done inline here (user-initiated)

  return {
    title: job?.canonical_title,
    company: job?.company,
    location: job?.location,
    postedAt: job?.posted_at,
    applyUrl: job?.apply_url,
    roleSummary: job?.role_summary,
    skillsRequired: job?.skills_required,
    skillsPreferred: job?.skills_preferred,
    techStack: job?.tech_stack,
    workMode: job?.work_mode,
    visaSponsorship: job?.visa_sponsorship,
    fitScore: score?.fit_score,
    skillsMatched: score?.skills_matched,
    skillsMissing: score?.skills_missing,
    fitReason: score?.fit_reason,
    companyIntel: intel ?? null,
  };
}
```

---

## 12. Manual Job Paste Flow

Users can paste a raw job description from any source. This creates a real `jobs` row with `source = 'manual'`.

```typescript
// app/api/jobs/manual/route.ts
export async function POST(req: Request) {
  const { rawJdText, applyUrl } = await req.json();
  const session = await getServerSession(authOptions);

  // 1. Run Haiku enrichment on pasted text
  const [enriched] = await enrichJobsBatch([{ description: rawJdText } as any]);

  // 2. Insert as real jobs row
  const { data: job } = await supabase.from('jobs').insert({
    canonical_title: enriched.role_summary?.split(' ').slice(0, 6).join(' ') ?? 'Manually Added',
    company:         enriched.company ?? 'Unknown',
    location:        enriched.location ?? 'Unknown',
    description:     rawJdText,
    source:          'manual',
    apply_url:       applyUrl ?? enriched.apply_url,
    ...enriched,
    enriched_at:     new Date(),
  }).select().single();

  // 3. Score against active resume
  const resume = await getActiveResume(session!.user.id);
  const [score] = await scoreJobsBatch([job], resume);
  await supabase.from('job_scores').insert({ ...score, job_id: job.id, user_id: session!.user.id });

  return Response.json({ job, score });
}
```

Manual jobs appear in the job feed with a **"Manually Added"** badge and are fully trackable through the application pipeline.

---

## 13. API Routes

```
POST   /api/search/run           → trigger on-demand full search (background)
GET    /api/search/stream        → SSE streaming search with live progress
GET    /api/jobs                 → paginated job list with scores + filters
GET    /api/jobs/:id             → single job detail with full enriched fields
POST   /api/jobs/manual          → submit manually pasted job description
POST   /api/resume/upload        → upload + parse resume, store in Supabase
POST   /api/company-intel/:name  → trigger company intel fetch for a company
GET    /api/search/configs       → get user's search configurations
POST   /api/search/configs       → create or update a search config
GET    /api/search/runs          → search run history (audit log)
GET    /api/search/runs/:id      → single run status (for progress polling fallback)
POST   /api/analysis             → create or load analysis_session for job+resume
```

---

## 14. Frontend Components

```
components/
  JobBoard/
    JobBoard.tsx         — split-pane container (left list + right detail panel)
    JobList.tsx          — left pane: compact scrollable job list
    JobListItem.tsx      — single row: title · company · score badge · work_mode chip
    JobDetailPanel.tsx   — right pane: tabbed panel [Job Details] [Company Intel]
    JobDetailsTab.tsx    — role summary · skills pills · apply button · fit score
    CompanyIntelTab.tsx  — recent news · strategic direction · hiring signals · red flags
    ManualPasteModal.tsx — textarea + apply URL input → POST /api/jobs/manual

  Search/
    SearchTrigger.tsx    — "Search Now" button + SSE progress bar
    SearchProgress.tsx   — stage indicator: Scraping → Enriching → Scoring → Done
    SearchConfig.tsx     — keywords · companies · sources config form

  Resume/
    ResumeUpload.tsx     — drag-and-drop PDF/DOCX upload
    ResumeSkills.tsx     — parsed skills display with edit capability
    AnalysisPanel.tsx    — deep analysis view (reads from analysis_sessions)
```

---

## 15. Cost Estimate (Monthly)

| Service | Usage | Cost |
|---|---|---|
| Apify Starter | Daily scrapes × 6 sources | **$29/mo** |
| SerpAPI | 30 searches/day × 30 days = 900 queries | **~$5/mo** (100 free/mo, then $50/5k) |
| Claude Haiku (enrichment) | ~200 jobs/day × 30 = 6,000 jobs ÷ 10/call = 600 calls | **~$0.50/mo** |
| Claude Haiku (dedup Stage 3) | ~50 calls/mo | **~$0.05/mo** |
| Claude Sonnet (scoring) | 6,000 jobs/mo ÷ 5/call = 1,200 calls | **~$5–8/mo** |
| Claude Sonnet (company intel) | ~20 companies/mo × 1 fetch | **~$0.50/mo** |
| Supabase (free tier) | Storage + queries | **$0/mo** |
| Vercel (Hobby) | Frontend + lightweight API routes | **$0/mo** |
| **Total** | | **~$40–45/mo** |

---

## 16. Resolved Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Job enrichment model | Claude Haiku | High-volume extraction task; Haiku is accurate and ~20× cheaper than Sonnet |
| Skills structure | Three arrays (required / preferred / tech_stack) | Enables granular filtering; required vs preferred matters for gap analysis |
| Company intel trigger | Manual + optional auto for top matches | Avoid wasting API on companies user isn't interested in |
| Company intel caching | Shared per company, 7-day TTL | One fetch serves all jobs from same company |
| Manual paste flow | Creates real `jobs` row with `source='manual'` | Enables full application tracking, dedup, and scoring |
| Search progress | SSE stream + `search_runs.progress` polling fallback | SSE for real-time; polling ensures progress visible if SSE drops |
| Search timeout | 5 minutes (`maxDuration = 300`) | Sufficient for full dual-source pipeline |
| Resume page data | `buildJobContext()` reads from DB before calling Claude | No redundant recomputation; only fetches what's missing |
| Deep analysis storage | `analysis_sessions` table | Persistent per job+resume combo; Resume page loads existing sessions |

---

*Document version 2.0 — Reflects full redesign with SerpAPI, Haiku enrichment, Company Intel, SSE streaming, manual paste, and split-pane UI.*
