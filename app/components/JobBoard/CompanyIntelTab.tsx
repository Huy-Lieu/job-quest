'use client'

// app/components/JobBoard/CompanyIntelTab.tsx
// Company intelligence panel — [Get Intel] trigger, displays cached or fresh intel.

import { useState } from 'react'
import { Building2, TrendingUp, Newspaper, Zap, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CompanyIntel {
  id?:                  string
  company_name:         string
  summary:              string
  recent_news:          string[]
  strategic_direction:  string
  hiring_signals:       string[]
  red_flags:            string[]
  fetched_at:           string
  expires_at:           string
  role_alignment?:      string | null
}

interface CompanyIntelTabProps {
  companyName:   string
  jobId:         string
  /** Pre-loaded intel from DB (may be null if not yet fetched or expired) */
  initialIntel?: CompanyIntel | null
  /** role_alignment already stored on the job row */
  roleAlignment?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function BulletList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground italic">{emptyText}</p>
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="text-sm text-foreground leading-relaxed flex gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground/50" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function CompanyIntelTab({
  companyName,
  jobId,
  initialIntel,
  roleAlignment,
}: CompanyIntelTabProps) {
  const [intel, setIntel]       = useState<CompanyIntel | null>(initialIntel ?? null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // Merge role_alignment from the job row into the intel object if not already there
  const displayIntel: CompanyIntel | null = intel
    ? { ...intel, role_alignment: intel.role_alignment ?? roleAlignment ?? null }
    : null

  async function fetchIntel() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/company-intel/${encodeURIComponent(companyName)}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ jobId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Request failed (${res.status})`)
      }
      const { intel: fresh } = await res.json()
      setIntel(fresh)
    } catch (err) {
      setError((err as Error).message ?? 'Failed to fetch company intel')
    } finally {
      setLoading(false)
    }
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!displayIntel) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-4">
        <div className="rounded-full bg-muted p-4">
          <Building2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium text-sm">No intel yet for {companyName}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Fetch recent news, strategic signals, and hiring momentum — cached for 7 days.
          </p>
        </div>
        {error && (
          <p className="text-xs text-red-500 max-w-xs">{error}</p>
        )}
        <Button
          onClick={fetchIntel}
          disabled={loading}
          size="sm"
          className="gap-2"
        >
          {loading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Fetching intel…</>
          ) : (
            <><Zap className="h-4 w-4" /> Get Intel</>
          )}
        </Button>
      </div>
    )
  }

  // ── Loaded state ───────────────────────────────────────────────────────────
  const fetchedLabel  = formatDate(displayIntel.fetched_at)
  const expiresLabel  = formatDate(displayIntel.expires_at)
  const isExpired     = new Date(displayIntel.expires_at) < new Date()

  return (
    <div className="flex flex-col gap-5 px-5 py-5">

      {/* Cache indicator */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border rounded-md px-3 py-2 bg-muted/40">
        <span>
          {isExpired
            ? 'Intel expired — refresh for latest signals'
            : `Intel from ${fetchedLabel} · Refreshes ${expiresLabel}`}
        </span>
        <button
          onClick={fetchIntel}
          disabled={loading}
          className="ml-2 flex items-center gap-1 hover:text-foreground transition-colors disabled:opacity-50"
          title="Refresh intel"
        >
          {loading
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-500 rounded-md bg-red-50 dark:bg-red-500/10 px-3 py-2">{error}</p>
      )}

      {/* Role alignment — shown first, most candidate-relevant */}
      {displayIntel.role_alignment && (
        <Section icon={<TrendingUp className="h-3.5 w-3.5" />} title="Why this role matters here">
          <p className="text-sm text-foreground leading-relaxed">{displayIntel.role_alignment}</p>
        </Section>
      )}

      {/* Company summary */}
      {displayIntel.summary && (
        <Section icon={<Building2 className="h-3.5 w-3.5" />} title="Company overview">
          <p className="text-sm text-foreground leading-relaxed">{displayIntel.summary}</p>
        </Section>
      )}

      {/* Strategic direction */}
      {displayIntel.strategic_direction && (
        <Section icon={<TrendingUp className="h-3.5 w-3.5" />} title="Strategic direction">
          <p className="text-sm text-foreground leading-relaxed">{displayIntel.strategic_direction}</p>
        </Section>
      )}

      {/* Recent news */}
      <Section icon={<Newspaper className="h-3.5 w-3.5" />} title="Recent news">
        <BulletList items={displayIntel.recent_news} emptyText="No recent news found." />
      </Section>

      {/* Hiring signals */}
      <Section icon={<Zap className="h-3.5 w-3.5" />} title="Hiring signals">
        <BulletList items={displayIntel.hiring_signals} emptyText="No hiring signals detected." />
      </Section>

      {/* Red flags — only render section if there are any */}
      {displayIntel.red_flags?.length > 0 && (
        <Section icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />} title="Watch-outs">
          <BulletList items={displayIntel.red_flags} emptyText="" />
        </Section>
      )}
    </div>
  )
}
