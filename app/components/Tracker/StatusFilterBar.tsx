'use client'

import { Application, ApplicationStatus, STATUS_LABELS } from '@/lib/types'

const ALL_STATUSES: ApplicationStatus[] = [
  'saved', 'applied', 'phone_screen', 'interview', 'offer', 'rejected', 'withdrawn',
]

interface StatusFilterBarProps {
  applications: Application[]
  filterStatus: ApplicationStatus | 'all'
  onChange: (status: ApplicationStatus | 'all') => void
}

export function StatusFilterBar({ applications, filterStatus, onChange }: StatusFilterBarProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onChange('all')}
        className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
          filterStatus === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
        }`}
      >
        All ({applications.length})
      </button>
      {ALL_STATUSES.map((s) => {
        const count = applications.filter((a) => a.status === s).length
        if (count === 0) return null
        return (
          <button
            key={s}
            onClick={() => onChange(s)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              filterStatus === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {STATUS_LABELS[s]} ({count})
          </button>
        )
      })}
    </div>
  )
}
