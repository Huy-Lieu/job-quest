'use client'

import { CheckCircle2, Loader2 } from 'lucide-react'

interface SearchProgressProps {
  stage:     string
  found:     number
  unique:    number
  isRunning: boolean
}

export function SearchProgress({ stage, found, unique, isRunning }: SearchProgressProps) {
  const stages = [
    { key: 'scraping',               label: 'Scraping' },
    { key: 'normalizing',            label: 'Normalizing' },
    { key: 'deduplicating',          label: 'Deduplicating' },
    { key: 'fetching_descriptions',  label: 'Descriptions' },
    { key: 'storing',                label: 'Saving' },
    { key: 'complete',               label: 'Done' },
  ]

  const currentIndex = stages.findIndex((s) => s.key === stage)

  return (
    <div className="space-y-3">
      {/* Stage pills */}
      <div className="flex gap-2 items-center flex-wrap">
        {stages.map((s, idx) => {
          const isActive = idx === currentIndex
          const isDone   = idx < currentIndex || stage === 'complete'
          return (
            <div
              key={s.key}
              className={`text-xs px-2 py-1 rounded-full font-medium transition-colors ${
                isDone
                  ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300'
                  : isActive
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 animate-pulse'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-500/15 dark:text-gray-400'
              }`}
            >
              {s.label}
            </div>
          )
        })}
      </div>

      {/* Progress stats */}
      {isRunning && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/50 rounded p-2 text-center">
            <p className="font-semibold text-foreground">{found}</p>
            <p className="text-muted-foreground">Found</p>
          </div>
          <div className="bg-muted/50 rounded p-2 text-center">
            <p className="font-semibold text-foreground">{unique || '--'}</p>
            <p className="text-muted-foreground">Unique</p>
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div className="w-full bg-muted/30 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            stage === 'complete' ? 'w-full bg-green-500' : 'bg-blue-500'
          }`}
          style={{ width: `${Math.max(20, ((currentIndex + 1) / stages.length) * 100)}%` }}
        />
      </div>

      {/* Status text */}
      {isRunning ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          {stage === 'scraping'      && 'Fetching jobs from sources…'}
          {stage === 'normalizing'   && 'Normalizing data…'}
          {stage === 'deduplicating'        && 'Removing duplicates…'}
          {stage === 'fetching_descriptions' && 'Fetching full job descriptions…'}
          {stage === 'storing'              && 'Saving to database…'}
          {stage === 'complete'      && 'Search complete!'}
        </p>
      ) : stage === 'complete' ? (
        <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Search complete — {found} found, {unique} new
        </p>
      ) : null}
    </div>
  )
}
