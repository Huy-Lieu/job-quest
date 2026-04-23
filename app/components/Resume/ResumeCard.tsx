'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ResumeVersion } from '@/lib/types'
import { FileText, Star, Trash2 } from 'lucide-react'

interface ResumeCardProps {
  resume: ResumeVersion
  isActive: boolean
  onSetActive: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (resume: ResumeVersion) => void
}

export function ResumeCard({ resume, isActive, onSetActive, onDelete, onEdit }: ResumeCardProps) {
  return (
    <Card className={`transition-shadow hover:shadow-sm ${isActive ? 'ring-2 ring-primary' : ''}`}>
      <CardContent className="py-4 px-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <p className="font-medium text-sm truncate">{resume.variant_name}</p>
          </div>
          {isActive && <Badge variant="secondary" className="text-xs flex-shrink-0">Default</Badge>}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">{resume.content?.slice(0, 120)}...</p>
        <div className="flex items-center gap-2 pt-1">
          {!isActive && (
            <button onClick={() => onSetActive(resume.id)} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
              <Star className="h-3 w-3" /> Set default
            </button>
          )}
          <button onClick={() => onEdit(resume)} className="text-xs text-muted-foreground hover:text-foreground ml-auto">Edit</button>
          <button onClick={() => onDelete(resume.id)} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
