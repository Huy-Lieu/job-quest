# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev       # Start dev server (Next.js)
npm run build     # Production build
npm run lint      # ESLint
```

Unit tests: `npm test` (Vitest). See `package.json` scripts.

## Architecture Overview

JobQuest is an AI-powered job application tracker built with Next.js App Router, Supabase (PostgreSQL), NextAuth (credentials + JWT), Anthropic Claude, Apify (web scraping), and SerpAPI (Google Jobs).

**Core flows:**

1. **Job Search Pipeline** (`/api/search/stream`, `/api/search/run`): Fires Apify scrapers + SerpAPI in parallel → normalizes raw output → early dedup (source ID + hash, free) → location filter (ISO country code matching, free) → description fetch for weak ATS listings (Apify rag-web-browser, parallel batches of 3) → fuzzy dedup (free title-similarity, no Claude) → store jobs in `jobs` + `job_sources`. No Claude at search time — LLM enrichment and scoring are on-demand only. Progress streamed via SSE (`maxDuration = 300`) with auto-reconnect (1 retry after 3 s). Shared pipeline logic: `lib/pipeline/core.ts` (`runPipelineCore`). Primary trigger today: **SSE from the dashboard**; `POST /api/search/run` exists for internal/cron-style callers (see Cron note below).

2. **Shared Context** (`lib/context.ts` → `buildJobContext()`): DB-only assembler for job row + scores + company intel (no Claude). Intended for routes or features that need one consistent payload; wire it where needed.

3. **Resume Analysis** (`/api/resume/analyze`): Multi-step Claude Sonnet flow (job analysis, optional company search via Apify, gap/ATS, two tailored resume texts, prep, cover letter). Today the route **persists the combined result as JSON on a new `resume_versions` row** (`type: customized`), not incremental `analysis_sessions` sections. Re-running analysis creates another version row.

4. **Company Intelligence** (`/api/company-intel/:name`): On-demand fetch (manual trigger or auto for top matches). Apify RAG browser fetches recent news → Claude Sonnet synthesizes into structured intel. Cached in `company_intel` table with 7-day TTL, shared across all jobs from the same company.

5. **Application Tracking** (`/api/applications`): Manual or auto-detected applications. Every status change awards XP server-side and checks achievements; level = XP ÷ 100.

6. **Scheduled search (future)** — `app/api/cron/search/route.ts` + `vercel.json`: Code exists to call `POST /api/search/run` for due configs, but **scheduled cron is not treated as live in the current product phase** (focus is interactive search from the dashboard). When enabled: protect with `Authorization: Bearer CRON_SECRET`; align cron → `/api/search/run` auth with the same header contract.

## Key Directories

- [app/api/](app/api/) — All backend API routes (Next.js Route Handlers)
- [app/api/search/stream/](app/api/search/stream/) — SSE streaming search route (`maxDuration = 300`)
- [app/api/jobs/manual/](app/api/jobs/manual/) — Manually pasted job ingestion endpoint
- [app/api/company-intel/](app/api/company-intel/) — Company intelligence fetch + cache endpoint
- [app/dashboard/](app/dashboard/) — Protected UI pages; guarded by `middleware.ts` which redirects unauthenticated requests to `/login`
- [lib/apify/](lib/apify/) — Apify source wrappers (`sources.ts`), actor runner with polling (`search.ts`), parallel orchestration (`orchestrate.ts`), post-filter description enrichment (`descriptions.ts` — Workday, SmartRecruiters, Workable, Recruitee via rag-web-browser in batches of 3)
- [lib/serp/](lib/serp/) — SerpAPI Google Jobs integration (`search.ts`, `normalize.ts`)
- [lib/claude/](lib/claude/) — Haiku enricher (`enricher.ts`: 5 jobs/call batches), Sonnet scorer (`scorer.ts`: 5 jobs/call), Haiku dedup helper (`dedup.ts`: YES/NO only, unused at search time)
- [lib/pipeline/](lib/pipeline/) — Shared pipeline orchestrator (`core.ts`), raw-to-canonical normalization with `country_code` inference (`normalize.ts`), 3-stage dedup split into `deduplicateEarly()` + `deduplicateFuzzy()` (`deduplicate.ts`)
- [lib/context.ts](lib/context.ts) — `buildJobContext()`: DB-only shared job payload (optional integration point)
- [lib/xp.ts](lib/xp.ts) — XP award, level calculation, streak tracking, achievement unlocks
- [lib/types.ts](lib/types.ts) — All shared TypeScript interfaces
- [lib/supabase.ts](lib/supabase.ts) — Supabase client (anon for browser, admin/service key for server)
- [lib/auth.ts](lib/auth.ts) — NextAuth `CredentialsProvider` with bcrypt verification

## Database (Supabase / PostgreSQL)

Core tables: `users`, `jobs`, `job_sources`, `job_scores`, `applications`, `resume_versions`, `resumes`, `search_configs`, `search_runs`, `achievements`, `company_intel`. (`analysis_sessions` may exist from migrations; resume analyze currently uses `resume_versions` for persisted output.)

**Key columns added to `jobs` in v2:** `role_summary`, `skills_required` (text[]), `skills_preferred` (text[]), `tech_stack` (text[]), `work_mode`, `visa_sponsorship`, `experience_years_min`, `experience_years_max`, `education_level`, `security_clearance`, `benefits_highlights` (text[]), `languages_required` (text[]), `apply_url`, `enriched_at`, `sources_count`, `role_alignment`, `source`.

**Key columns added to `search_runs` in v2:** `jobs_enriched`, `progress` (JSONB — used for SSE fallback polling).

The admin client (`SUPABASE_SERVICE_KEY`) is used server-side for writes; the anon client is used client-side.

See `jobquest-search-architecture.md` for full schema and migration SQL.

## Environment Variables

See [.env.example](.env.example). Required:
- `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_KEY`
- `ANTHROPIC_API_KEY` — Claude (Sonnet for resume analysis/company intel — NOT used at search time)
- `APIFY_TOKEN` — job scraping (LinkedIn, Indeed, ATS pages, career pages, PhD boards)
- `SERPAPI_KEY` — Google Jobs aggregation via `google_jobs` engine. Toggle per search config via `serp_enabled` boolean. Offset pagination tracked via `serp_next_offset` (advances +10 per run, resets to 0 when `results < 10` or offset reaches `SERP_MAX_OFFSET = 50`).
- `CRON_SECRET` — bearer token for `/api/cron/search`
- `NEXT_PUBLIC_URL` + `NEXTAUTH_URL`

## Claude Usage Patterns

Claude is **NOT called during the job search pipeline**. All search-time stages are free (DB lookups + in-memory logic).

Claude is called **on-demand** only:
- **Resume analysis** (`/api/resume/analyze`): Claude Sonnet (see route for model id). Full run each request; stores output on `resume_versions` (customized JSON blob), not section-by-section `analysis_sessions`.
- **Company intel** (`/api/company-intel/:name`): Claude Sonnet 4.6 synthesizes Apify RAG results into structured intel (company layer cached 7 days, role layer per-job).
- **Job enrichment** (`lib/claude/enricher.ts`): Claude Haiku — available for future on-demand enrichment per job. Not called at search time.
- **Job scoring** (`lib/claude/scorer.ts`): Claude Sonnet 4.6 — available for future on-demand scoring. Not called at search time.
- **Dedup** (`lib/claude/dedup.ts`): Claude Haiku — kept but no longer used. Fuzzy dedup is now free title-similarity.

When adding Claude calls: use prompt caching where the system prompt or large context is reused across batches. Always batch — never call Claude once per job in a loop.

## Pipeline Stage Order

All stages are free of Claude calls at search time.

```
Scrape (Apify + SerpAPI in parallel)
  → Normalize (raw JSON → canonical schema + country_code inference)
  → Early Dedup — free (Stage 1: source job ID, Stage 2: SHA-256 hash)
  → Location Filter — free (ISO country_code exact match; REMOTE/MULTI always pass)
  → Description Enrichment — rag-web-browser for sources with incomplete listings:
      • Workday       (bulletFields[] only — React SPA needs Chromium render)
      • SmartRecruiters (description always '' from listing API)
      • Workable      (listing API returns snippet only)
      • Recruitee     (conditional — only when description < 500 chars)
      Processed in parallel batches of 3 (3 × 8192MB = 24GB, safe under Apify free 32GB)
      LinkedIn/Indeed/Greenhouse/Lever/Ashby already return full descriptions — skip
  → Fuzzy Dedup — free title-similarity check (same company + normalized title substring match)
  → Store (Supabase: jobs + job_sources — no enriched fields, no scores)
  → Emit SSE complete event / update search_runs.progress
```

Enrichment (Haiku) and scoring (Sonnet) are triggered on-demand per job from the detail panel.

Shared pipeline logic: `lib/pipeline/core.ts` (`runPipelineCore`). The SSE route (`app/api/search/stream/route.ts`) and `lib/search/run-pipeline.ts` are thin wrappers that pass a `ProgressCallback` and own lifecycle (SSE / DB writes).

## UI Architecture

The jobs page (`/jobs`) is a **full split-pane layout** — compact scrollable list on the left, detail panel on the right. There is no separate `/jobs/[id]` detail page. The right panel has exactly **two tabs: [Job Details] and [Company Intel]**. Manually pasted jobs appear in a separate "Manually Added" section at the bottom of the left pane.

The Resume page loads masters and past customized versions via `/api/resume/masters` and `/api/resume/versions`. **Analyze a Job** calls `/api/resume/analyze` and appends a new `resume_versions` row with the JSON result. Use `buildJobContext()` when you need a single server-side job+intel payload without duplicating Supabase queries.

## Resume File Storage

Google Drive and iCloud are **not used**. Resume files (PDF/DOCX uploads and Claude-generated outputs) are stored in **Supabase Storage** (`resumes` bucket).

Path structure:
```
resumes/
└── {userId}/
    ├── master/
    │   ├── resume_embedded.pdf
    │   └── resume_automotive.pdf
    └── applications/
        └── {jobId}/
            ├── resume_conservative.pdf
            ├── resume_aggressive.pdf
            └── cover_letter.pdf
```

- Upload: `supabase.storage.from('resumes').upload(path, file)`
- Signed URL (private): `supabase.storage.from('resumes').createSignedUrl(path, 3600)`
- The full `storagePath` is stored in the `resume_versions` table, not a Drive file ID.
- Supabase Storage free tier: 1GB — sufficient for hundreds of resume files.
- Google Drive may be added later as an optional sync feature, but is not in scope now.

## next.config.ts Notes

`serverExternalPackages: ['pdf-parse', 'mammoth']` — required for PDF/DOCX parsing (they need Node.js `fs`). Add new server-only file-system packages here.
