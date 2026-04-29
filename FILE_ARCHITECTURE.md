# File Architecture — Split File Reference

This document tracks the file-splitting work done to keep every file under ~280–300 lines,
preventing silent truncation bugs when AI tools read or write them.

---

## Split 1 — Search Pipeline (`app/api/search/stream/route.ts`)

**Original:** `app/api/search/stream/route.ts` (~480 lines, was truncated)

**Result:**

| File | Lines | Responsibility |
|------|-------|----------------|
| `app/api/search/stream/route.ts` | ~180 | SSE wrapper only: auth, search_runs lifecycle, SSE emission, cancellation |
| `lib/pipeline/core.ts` | ~360 | Full shared pipeline; used by SSE route + `run-pipeline` helper |
| `lib/search/run-pipeline.ts` | ~65 | Non-SSE wrapper: calls `runPipelineCore`, owns `search_runs` DB lifecycle |

**Key exports:**
- `core.ts` → `runPipelineCore(config, userId, onProgress?): Promise<PipelineResult>`
- `route.ts` → `GET`, `POST`, `DELETE` (Next.js Route Handlers)

**Pipeline stage order (in `core.ts`) — all free, no Claude at search time:**
1. Scrape — Apify + SerpAPI in parallel
2. Normalize — raw JSON → canonical schema with `country_code`
3. Early dedup — source job ID + content hash (DB)
4. Location filter — ISO country code match; REMOTE/MULTI pass-through
5. Description fetch — rag-web-browser for weak ATS listings (Workday, SmartRecruiters, Workable, Recruitee), batches of 3
6. Fuzzy dedup — free title-similarity (no Claude)
7. Store — `jobs` + `job_sources` → Supabase (LLM enrichment fields not filled at search time)

---

## Split 2 — Jobs Dashboard (`app/dashboard/jobs/page.tsx`)

**Original:** `app/dashboard/jobs/page.tsx` (2,247 lines — massive monolith)

**Result:**

| File | Lines | Responsibility |
|------|-------|----------------|
| `app/dashboard/jobs/constants.ts` | 153 | SOURCE_LABELS, SOURCE_COLORS, AGE_TONE_STYLES, helpers: relativeTime, postingAgePill, stripHtml, pickBestSource, googleSearchUrl |
| `app/components/Search/RunSearchPanel.tsx` | 88 | Run/Stop toggle button + config selector dropdown |
| `app/components/Search/NewConfigForm.tsx` | 201 | Create/edit search config form (modal + inline) |
| `app/components/Search/RunsTab.tsx` | 76 | Runs history tab (list of past search runs) |
| `app/components/Jobs/JobCard.tsx` | 207 | Card-style job display (mobile / non-table view) |
| `app/components/Jobs/JobTableRow.tsx` | 262 | Desktop table row: fmt, TABLE_COLS, TypePill, WorkModePill, SponsorPill, SkillChips, JobsHeader, JobRowDesktop |
| `app/components/Jobs/JobListRow.tsx` | ~120 | Split-view list row + `JobDetailEmptyState`; detail pane lives in `JobDetailPane.tsx` |
| `app/dashboard/jobs/page.tsx` | 514 | State management, fetch helpers, SSE run/stop logic, layout only |

**Import paths** (use `@/app/...` prefix for files under `app/`):
```ts
import { SOURCE_LABELS, ... } from '@/app/dashboard/jobs/constants'
import { RunSearchPanel }     from '@/app/components/Search/RunSearchPanel'
import { NewConfigForm }      from '@/app/components/Search/NewConfigForm'
import { RunsTab }            from '@/app/components/Search/RunsTab'
import { JobCard }            from '@/app/components/Jobs/JobCard'
import { JobRowDesktop, ... } from '@/app/components/Jobs/JobTableRow'
import { JobListRow, JobDetailEmptyState } from '@/app/components/Jobs/JobListRow'
import { JobDetailPane } from '@/app/components/Jobs/JobDetailPane'
```

---

## Split 3 — Job detail pane (canonical: `app/components/Jobs/JobDetailPane.tsx`)

**Note:** An older duplicate lived under `app/components/JobBoard/JobDetailPanel.tsx`. The dashboard split-pane uses **`JobDetailPane`** from `app/components/Jobs/`.

**Responsibility:** Two-tab panel (Job Details + Company Intel); shared labels/helpers from `@/app/dashboard/jobs/constants`.

**Legacy:** `app/components/JobBoard/*` may still exist for reference; prefer `@/app/components/Jobs/JobDetailPane` for new work.

---

## Rules going forward

- **Hard limit: 300 lines per file.** If a file approaches this, split before editing.
- **Never use bash heredoc (`cat >> file << 'EOF'`)** — causes null byte corruption. Use the Write tool for short files or Python `f.write()` for files containing template literals (backtick + `${`).
- **Always verify after writing:** `wc -l file && tail -5 file`
- **Run `npx tsc --noEmit`** after any structural change to catch import errors early.
- **Import path convention:** Files under `app/` must use `@/app/...`; shadcn/ui components use `@/components/ui/...`.
