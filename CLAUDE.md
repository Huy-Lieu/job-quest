# CLAUDE.md

This file provides guidance when working with code in this repository. It supersedes all separate architecture docs (`AGENTS.md`, `jobquest-search-architecture.md`, `FILE_ARCHITECTURE.md` — those files are deleted).

## Commands

```bash
npm run dev       # Start dev server (Next.js)
npm run build     # Production build
npm run lint      # ESLint
npm test          # Vitest unit tests
npx tsc --noEmit  # Type-check without building
```

## Architecture Overview

JobQuest is an AI-powered job application tracker built with Next.js App Router, Supabase (PostgreSQL), NextAuth (credentials + JWT), Anthropic Claude, Apify (web scraping), and SerpAPI (Google Jobs).

**Core flows:**

1. **Job Search Pipeline** (`/api/search/stream`): Fires Apify scrapers + SerpAPI in parallel → normalizes → early dedup → location filter → description enrichment → fuzzy dedup → store. No Claude at search time. Progress streamed via SSE (`maxDuration = 300`) with auto-reconnect. Shared pipeline logic: `lib/pipeline/core.ts` (`runPipelineCore`).

2. **Shared Context** (`lib/context.ts` → `buildJobContext()`): DB-only assembler for job row + scores + company intel (no Claude). Use this wherever a server-side route needs a consistent job payload — avoids duplicating Supabase queries.

3. **Resume Analysis** (`/api/resume/analyze`): Multi-step Claude Sonnet flow (job analysis, optional Apify company search, gap/ATS, two tailored resume texts, prep, cover letter). Persists combined result as JSON on a new `resume_versions` row (`type: customized`). Re-running creates another version row.

4. **Company Intelligence** (`/api/company-intel/:name`): On-demand. Apify RAG browser → Claude Sonnet → structured intel. Cached in `company_intel` table with 7-day TTL per company. Role-level intel stored per-job in `jobs.role_company_intel`.

5. **Application Tracking** (`/api/applications`): Manual or auto-detected applications. Every status change awards XP server-side and checks achievements; level = XP ÷ 100.

6. **Scheduled search (future)** — `app/api/cron/search/route.ts` + `vercel.json`: Calls `POST /api/search/run` for due configs. **Not live in current product phase.** When enabled: protect with `Authorization: Bearer CRON_SECRET`.

## Pipeline Stage Detail

All stages are free of Claude calls at search time.

```
Scrape (Apify actors + SerpAPI in parallel via Promise.allSettled)
  → Normalize (raw JSON → canonical schema + country_code inference)
  → Early Dedup — free
      Stage 1: source job ID match
      Stage 2: SHA-256 hash of (company + title + location)
  → Location Filter — free (ISO country_code exact match; REMOTE/MULTI always pass)
  → Description Enrichment — rag-web-browser for sources with weak listings:
      • Workday         (CXS JSON API returns bulletFields[] — Chromium render needed for full text)
      • SmartRecruiters (description always '' from listing API)
      • Workable        (listing API returns snippet only)
      • Recruitee       (conditional — only when description < 500 chars)
      Processed in parallel batches of 3. LinkedIn/Indeed/Greenhouse/Lever/Ashby skip.
  → Fuzzy Dedup — free title-similarity (same company + normalized title substring match)
  → Store (Supabase: jobs + job_sources — no enriched fields, no scores at this stage)
  → Emit SSE complete event / update search_runs.progress
```

**Workday scraping approach:** Uses the direct Workday CXS JSON API (`POST /wday/cxs/{tenant}/{dc}/jobs`) via `fetchWorkdayBoard()` in `lib/apify/ats-boards.ts`. Does NOT use an Apify actor for Workday. Tenants are resolved by `resolveWorkdayTenants()` which merges `KNOWN_WORKDAY` (built-in) with user-added entries from the `workday_registry` DB table. Location filtering uses the `appliedFacets.locationCountry` parameter (ISO → country name mapping in `ats-boards.ts`).

**Error handling:** Each Apify source returns `{ jobs, error }`. Per-source errors are collected into `sourceErrors` and bubbled up to the SSE stream as a `warnings` event, shown as dismissible toasts in the UI. The outer SSE `.catch()` handler emits an `error` event and closes the stream — no silent failures.

Enrichment (Haiku) and scoring (Sonnet) are triggered on-demand per job from the detail panel.

## Key Directories

- `app/api/` — All backend API routes (Next.js Route Handlers)
- `app/api/search/stream/` — SSE streaming search route (`maxDuration = 300`). Owns: auth, `search_runs` row lifecycle, SSE emission, cancellation. Pipeline logic in `lib/pipeline/core.ts`.
- `app/api/jobs/` — Paginated job feed with filters: `min_score`, `source`, `job_type`, `recommended`, `work_mode`, `visa`, `location` (ILIKE), `phd`
- `app/api/jobs/manual/` — Manually pasted job ingestion endpoint
- `app/api/company-intel/` — Company intelligence fetch + cache endpoint
- `app/api/workday-registry/` — GET/POST/DELETE for user-added Workday tenants (merges built-in `KNOWN_WORKDAY` with `workday_registry` table rows)
- `app/dashboard/` — Protected UI pages; guarded by `middleware.ts`
- `app/components/Jobs/` — `JobsTab.tsx`, `JobListRow.tsx`, `JobDetailPane.tsx` — canonical job UI components
- `lib/apify/` — Apify source wrappers (`sources.ts`), actor runner (`search.ts`), orchestration (`orchestrate.ts`), description enrichment (`descriptions.ts`), ATS direct APIs (`ats-boards.ts`: Workday CXS, Greenhouse, Lever, Ashby), tenant resolution (`ats-resolver.ts`)
- `lib/serp/` — SerpAPI Google Jobs integration (`search.ts`, `normalize.ts`)
- `lib/claude/` — Haiku enricher (`enricher.ts`: 5 jobs/call), Sonnet scorer (`scorer.ts`: 5 jobs/call)
- `lib/pipeline/` — `core.ts` (`runPipelineCore`), `normalize.ts` (raw→canonical + country_code), `deduplicate.ts` (`deduplicateEarly()` + `deduplicateFuzzy()`)
- `lib/context.ts` — `buildJobContext()`: DB-only shared job payload
- `lib/xp.ts` — XP award, level calculation, streak tracking, achievement unlocks
- `lib/types.ts` — All shared TypeScript interfaces
- `lib/supabase.ts` — Supabase client (anon for browser, admin for server)
- `lib/auth.ts` — NextAuth `CredentialsProvider` with bcrypt (12 rounds) + email-based lookup

## Database (Supabase / PostgreSQL)

**Core tables:** `users`, `jobs`, `job_sources`, `job_scores`, `applications`, `resume_versions`, `resumes`, `search_configs`, `search_runs`, `achievements`, `company_intel`, `workday_registry`.

**`workday_registry`** — user-added Workday tenants (added in migration `20260515_workday_registry.sql`):
```sql
create table workday_registry (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  key text not null, tenant text not null, dc text not null, site text not null,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);
```

**Key columns on `jobs`:** `canonical_title`, `company`, `location`, `country_code`, `description`, `salary_min/max`, `salary_currency`, `job_type`, `is_phd`, `status`, `metadata`, `role_summary`, `skills_required` (text[]), `skills_preferred` (text[]), `tech_stack` (text[]), `work_mode`, `visa_sponsorship`, `experience_years_min/max`, `education_level`, `security_clearance`, `benefits_highlights` (text[]), `languages_required` (text[]), `seniority_level`, `role_type`, `enriched_at`, `role_intel`, `application_deadline`, `salary_levels`, `role_company_intel`.

**Key columns on `search_runs`:** `jobs_enriched`, `progress` (JSONB — polling fallback for SSE reconnects).

**Auth:** Admin client (`SUPABASE_SERVICE_KEY`) for all server-side writes; anon client for browser.

**Migrations:** Run raw SQL manually in Supabase dashboard (no Prisma). Migration files live in `supabase/migrations/`.

## UI & Components

The jobs dashboard (`/dashboard/jobs`) is a **split-pane layout** — compact scrollable list on the left, detail panel on the right. No separate `/jobs/[id]` page. The right panel has two tabs: **Job Details** and **Company Intel**.

**Filter bar** (in `JobsTab.tsx`) supports: min score (range slider), source (dropdown), job type (dropdown), recommended (checkbox), work mode (dropdown: remote/hybrid/on-site), visa sponsorship (checkbox), location (debounced text input, 300 ms).

**State ownership:** All filter state lives in `app/dashboard/jobs/page.tsx` and is passed down to `JobsTab`. `JobsTab` owns only local UI state (collapsed panel, location debounce input, intel cache).

**Intel cache:** Company intel is cached in a `Map<jobId, FetchedIntel>` in `JobsTab` via `intelCache` + `onIntelFetched` — persists across job selections within a session without re-fetching.

**SSE warnings:** The dashboard SSE reader tracks the current event type. A `warnings` event from the server (containing `sourceErrors`) renders as a dismissible `toast.warning()` with a 8-second duration.

**Mobile:** Job list renders full-width; selecting a job opens a fixed-position overlay (`z-50`). Desktop: CSS grid split, left panel collapsible with a toggle button.

## Auth Flow

- **Login** (`/app/login/page.tsx` → `NextAuth signIn`): Uses `email` field (not username). Credentials sent to `lib/auth.ts` `CredentialsProvider`.
- **Auth lookup** (`lib/auth.ts`): Queries `users` table by `email`. bcrypt compare at 12 rounds.
- **Register** (`/app/api/auth/register/route.ts`): Single registration route. Hashes password at 12 rounds, inserts to `users`. The old orphaned `/api/register` route is deleted.
- **Session:** JWT strategy via NextAuth. `session.user.id` used server-side for all user-scoped queries.

## Claude Usage Patterns

Claude is **NOT called during the job search pipeline**. All search-time stages are free.

Claude is called **on-demand** only:
- **Resume analysis** (`/api/resume/analyze`): Claude Sonnet. Full run per request; stores output on `resume_versions`.
- **Company intel** (`/api/company-intel/:name`): Claude Sonnet 4.6. Synthesizes Apify RAG results into structured intel.
- **Job enrichment** (`lib/claude/enricher.ts`): Claude Haiku — on-demand per job from detail panel.
- **Job scoring** (`lib/claude/scorer.ts`): Claude Sonnet 4.6 — on-demand per job from detail panel.

When adding Claude calls: use prompt caching for reused system prompts. Always batch — never call Claude once per job in a loop. Batch size: 5 jobs/call for enricher and scorer.

## Environment Variables

See `.env.example`. Required:
- `NEXTAUTH_SECRET` — `openssl rand -base64 32`
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_KEY`
- `ANTHROPIC_API_KEY` — Claude Sonnet/Haiku (not used at search time)
- `APIFY_TOKEN` — job scraping
- `SERPAPI_KEY` — Google Jobs via `google_jobs` engine. Toggle per config via `serp_enabled`. Offset: `serp_next_offset` advances +10/run, resets when `results < 10` or offset ≥ `SERP_MAX_OFFSET = 50`.
- `CRON_SE