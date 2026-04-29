# JobQuest - Current Search Architecture
**Version:** 2026-04-28  
**Source of truth:** `CLAUDE.md` + current codebase  
**Current phase focus:** Job searching only

---

## 1) Current Scope

The current implementation focus is the **job search pipeline** and related jobs dashboard workflows.

- In scope: source scraping, normalization, deduplication, location filtering, storage, and progress streaming.
- Out of current phase focus: deep resume-analysis architecture and broader intelligence orchestration.
- Search-time pipeline is intentionally **free of Claude model calls**.
- Cron route exists in code, but per current product status, **cron is not treated as implemented yet**.

---

## 2) Search Pipeline (Implemented)

Shared pipeline core:
- `lib/pipeline/core.ts` -> `runPipelineCore(config, userId, onProgress?)`

Search-time stage order (no Claude calls):
1. Scrape (Apify + SerpAPI in parallel)
2. Normalize (raw source data -> canonical schema + `country_code` inference)
3. Early dedup (source ID + hash checks)
4. Location filter (ISO country matching; REMOTE/MULTI passthrough)
5. Description completion for weak sources (Apify `rag-web-browser`, non-LLM)
6. Fuzzy dedup (title/company similarity, non-LLM)
7. Store (`jobs`, `job_sources`) + run status update (`search_runs`)

Design intent:
- Keep ingestion low-cost and predictable
- Avoid LLM latency/cost during high-volume search ingestion
- Reserve Claude for later on-demand features

---

## 3) Search Triggers and Wrappers

Current wrappers around the shared pipeline:
- `app/api/search/stream/route.ts`  
  - User-triggered interactive runs with SSE progress stream
  - `maxDuration = 300`
  - cancellation support
- `lib/search/run-pipeline.ts`  
  - non-SSE wrapper around `runPipelineCore`

Important current-state note:
- `app/api/cron/search/route.ts` exists, but scheduled automation is not considered fully implemented in current product scope.

---

## 4) Data Model Used by Search

Primary search tables:
- `search_configs`
- `search_runs`
- `jobs`
- `job_sources`

Key search config fields:
- `keywords`, `target_companies`, `locations`, `sources`
- `serp_enabled`
- `serp_query`
- `serp_next_offset`

Key run/progress fields:
- `search_runs.status`
- `search_runs.jobs_found`, `search_runs.jobs_new`
- `search_runs.progress` (stage + counters for UI progress/fallback display)

---

## 5) APIs Relevant to Current Scope

Core search APIs:
- `GET|POST|DELETE /api/search/stream` - interactive search via SSE
- `POST /api/search/run` - internal non-stream run entry
- `GET|POST /api/search/configs` - search config management
- `GET /api/search/runs` - run history
- `GET /api/jobs` - jobs list for dashboard

Current gap to acknowledge:
- `GET /api/search/runs/:id` is commonly referenced as fallback in docs/discussion, but is not currently present as an implemented route.

---

## 6) Frontend Focus in This Phase

UI work is centered on the jobs dashboard:
- create/edit search configurations
- run search and monitor progress
- browse/deduped results in list + detail layout
- use the run history for visibility/debugging

Current objective is stability and correctness of ingestion/search loops, not expansion of downstream analysis modules.

---

## 7) Cron Status (Current Product Position)

Cron architecture is present as code scaffolding, but for current planning:
- treat cron as **not yet implemented/activated**;
- do not consider scheduled search as a completed production capability in this phase;
- focus remains on manual/interactive search execution and correctness.

---

## 8) Phase Label

**Current phase:** Search Pipeline Stabilization

Focus:
- reliable ingest, dedup, and dashboard UX for interactive search
- documentation and types aligned with `lib/pipeline/core.ts` and SSE stages
- clean lint/test baseline for search-adjacent code

