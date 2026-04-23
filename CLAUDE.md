# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev       # Start dev server (Next.js)
npm run build     # Production build
npm run lint      # ESLint
```

There is no test suite configured.

## Architecture Overview

JobQuest is an AI-powered job application tracker built with Next.js App Router, Supabase (PostgreSQL), NextAuth (credentials + JWT), Anthropic Claude, Apify (web scraping), and SerpAPI (Google Jobs).

**Core flows:**

1. **Job Search Pipeline** (`/api/search/stream`, `/api/search/run`): Fires Apify scrapers + SerpAPI in parallel → normalizes raw output → **Haiku enrichment pass** (extracts structured fields from raw JD text, 10 jobs/call) → 3-stage deduplication (source job ID → content hash → Claude Haiku fuzzy match) → batch-scores jobs against the user's active resume using Claude Sonnet (5 jobs/call). Results stored in `jobs`, `job_sources`, `job_scores`. Progress streamed via SSE (`maxDuration = 300`).

2. **Shared Context** (`lib/context.ts` → `buildJobContext()`): Reads enriched job data, fit scores, and company intel from DB before calling Claude. Only fetches what's missing. Used by both the job detail panel and the Resume page to avoid redundant recomputation.

3. **Resume Analysis** (`/api/resume/analyze`): 7-layer Claude Sonnet analysis (gap analysis, ATS score, 2× tailored resumes, interview prep, cover letter). Reads from `analysis_sessions` if available; only runs Claude for missing sections. Stored per job+resume combo.

4. **Company Intelligence** (`/api/company-intel/:name`): On-demand fetch (manual trigger or auto for top matches). Apify RAG browser fetches recent news → Claude Sonnet synthesizes into structured intel. Cached in `company_intel` table with 7-day TTL, shared across all jobs from the same company.

5. **Application Tracking** (`/api/applications`): Manual or auto-detected applications. Every status change awards XP server-side and checks achievements; level = XP ÷ 100.

6. **Vercel Cron** (`vercel.json`, `/api/cron/search`): Runs at 07:00 UTC daily. Validates `Authorization: Bearer CRON_SECRET` then triggers the search pipeline for each due search config.

## Key Directories

- [app/api/](app/api/) — All backend API routes (Next.js Route Handlers)
- [app/api/search/stream/](app/api/search/stream/) — SSE streaming search route (`maxDuration = 300`)
- [app/api/jobs/manual/](app/api/jobs/manual/) — Manually pasted job ingestion endpoint
- [app/api/company-intel/](app/api/company-intel/) — Company intelligence fetch + cache endpoint
- [app/dashboard/](app/dashboard/) — Protected UI pages; guarded by `middleware.ts` which redirects unauthenticated requests to `/login`
- [lib/apify/](lib/apify/) — Apify source wrappers (`sources.ts`), actor runner with polling (`search.ts`), parallel orchestration (`orchestrate.ts`)
- [lib/serp/](lib/serp/) — SerpAPI Google Jobs integration (`search.ts`, `normalize.ts`)
- [lib/claude/](lib/claude/) — Haiku enricher (`enricher.ts`: 10 jobs/call), Sonnet scorer (`scorer.ts`: 5 jobs/call), Haiku dedup helper (`dedup.ts`: YES/NO only)
- [lib/pipeline/](lib/pipeline/) — Raw-to-canonical normalization (`normalize.ts`) and 3-stage dedup logic (`deduplicate.ts`)
- [lib/context.ts](lib/context.ts) — `buildJobContext()`: shared data assembler for job detail panel + resume page
- [lib/xp.ts](lib/xp.ts) — XP award, level calculation, streak tracking, achievement unlocks
- [lib/types.ts](lib/types.ts) — All shared TypeScript interfaces
- [lib/supabase.ts](lib/supabase.ts) — Supabase client (anon for browser, admin/service key for server)
- [lib/auth.ts](lib/auth.ts) — NextAuth `CredentialsProvider` with bcrypt verification

## Database (Supabase / PostgreSQL)

Core tables: `users`, `jobs`, `job_sources`, `job_scores`, `applications`, `resume_versions`, `resumes`, `search_configs`, `search_runs`, `achievements`, `company_intel`, `analysis_sessions`.

**Key columns added to `jobs` in v2:** `role_summary`, `skills_required` (text[]), `skills_preferred` (text[]), `tech_stack` (text[]), `work_mode`, `visa_sponsorship`, `experience_years_min`, `experience_years_max`, `education_level`, `security_clearance`, `benefits_highlights` (text[]), `languages_required` (text[]), `apply_url`, `enriched_at`, `sources_count`, `role_alignment`, `source`.

**Key columns added to `search_runs` in v2:** `jobs_enriched`, `progress` (JSONB — used for SSE fallback polling).

The admin client (`SUPABASE_SERVICE_KEY`) is used server-side for writes; the anon client is used client-side.

See `jobquest-search-architecture.md` for full schema and migration SQL.

## Environment Variables

See [.env.example](.env.example). Required:
- `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_KEY`
- `ANTHROPIC_API_KEY` — Claude (Haiku for enrichment/dedup, Sonnet for scoring/analysis/company intel)
- `APIFY_TOKEN` — job scraping (LinkedIn, Indeed, ATS pages, career pages, PhD boards)
- `SERPAPI_KEY` — Google Jobs aggregation via `google_jobs` engine. Toggle per search config via `serp_enabled` boolean. Offset pagination tracked via `serp_next_offset` (advances +10 per run, resets to 0 when `results < 10` or offset reaches `SERP_MAX_OFFSET = 50`).
- `CRON_SECRET` — bearer token for `/api/cron/search`
- `NEXT_PUBLIC_URL` + `NEXTAUTH_URL`

## Claude Usage Patterns

- **Job enrichment** (`lib/claude/enricher.ts`): Claude Haiku (`claude-haiku-4-5-20251001`), batches **10 jobs per call**. Extracts: `role_summary`, `skills_required`, `skills_preferred`, `tech_stack`, `work_mode`, `visa_sponsorship`, `apply_url`, `experience_years_min/max`, `education_level`, `security_clearance`, `benefits_highlights`, `languages_required`. Runs after normalization, before deduplication.
- **Deduplication** (`lib/claude/dedup.ts`): Claude Haiku, Stage 3 only (after source ID and hash checks both fail). Responds YES/NO only.
- **Job scoring** (`lib/claude/scorer.ts`): Claude Sonnet 4.6 (`claude-sonnet-4-6`), batches **5 jobs per call**. Uses enriched `skills_required` + `role_summary` (not raw description). Returns `fit_score` (0–100), `fit_reason`, `skills_matched`, `skills_missing`.
- **Resume analysis** (`/api/resume/analyze`): Claude Sonnet 4.6. Always reads `analysis_sessions` first — only calls Claude for sections not yet stored.
- **Company intel** (`/api/company-intel/:name`): Claude Sonnet 4.6 synthesizes Apify RAG results. Role alignment per job uses Haiku.

When adding Claude calls: use prompt caching where the system prompt or large context is reused across batches. Always batch — never call Claude once per job in a loop.

## Pipeline Stage Order

```
Scrape (Apify + SerpAPI in parallel)
  → Normalize (raw JSON → canonical schema, basic fields only)
  → Haiku Enrich (10 jobs/call — extract all structured fields from description)
  → Deduplicate (source ID → SHA-256 hash → Haiku fuzzy — fast first)
  → Sonnet Score (5 jobs/call — fit score vs active resume)
  → Store (Supabase: jobs + job_sources + job_scores)
  → Emit SSE complete event / update search_runs.progress
```

## UI Architecture

The jobs page (`/jobs`) is a **full split-pane layout** — compact scrollable list on the left, detail panel on the right. There is no separate `/jobs/[id]` detail page. The right panel has exactly **two tabs: [Job Details] and [Company Intel]**. Manually pasted jobs appear in a separate "Manually Added" section at the bottom of the left pane.

The Resume page uses `buildJobContext()` to load existing data before running any Claude calls. It does NOT re-run enrichment or scoring if the pipeline already computed those values. Deep analysis (gap, interview prep, cover letter, tailored resumes) runs on demand and is stored in `analysis_sessions`.

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
