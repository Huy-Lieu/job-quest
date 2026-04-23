'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Application, ApplicationStatus, STATUS_LABELS, STATUS_COLORS } from '@/lib/types'
import { ExternalLink, Trash2 } from 'lucide-react'

const ALL_STATUSES: ApplicationStatus[] = [
  'saved', 'applied', 'phone_screen', 'interview', 'offer', 'rejected', 'withdrawn',
]

interface ApplicationCardProps {
  application: Application
  onStatusChange: (id: string, status: ApplicationStatus) => void
  onDelete: (id: string) => void
}

export function ApplicationCard({ application, onStatusChange, onDelete }: ApplicationCardProps) {
  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="flex items-center gap-4 py-4">
        {/* Company initial */}
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
          {application.job?.company?.[0]?.toUpperCase() ?? '?'}
        </div>

        {/* Job info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold truncate">{application.job?.canonical_title ?? 'Unknown Role'}</p>
            {application.job?.job_sources?.[0]?.source_url && (
              <a href={application.job.job_sources[0].source_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {application.job?.company} {application.job?.location ? ` ${application.job.location}` : ''}
          </p>
          {application.notes && <p className="text-xs text-muted-foreground mt-1 truncate">{application.notes}</p>}
        </div>

        {/* Status selector */}
        <select
          value={application.status}
          onChange={(e) => onStatusChange(application.id, e.target.value as ApplicationStatus)}
          className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${STATUS_COLORS[application.status]}`}
        >
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>

        {/* Date */}
        <p className="text-xs text-muted-foreground hidden md:block flex-shrink-0">
          {new Date(application.created_at).toLocaleDateString()}
        </p>

        {/* Delete */}
        <button
          onClick={() => onDelete(application.id)}
          className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </CardContent>
    </Card>
  )
}
