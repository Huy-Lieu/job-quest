'use client'

import { SkillPill } from '@/app/components/ui/SkillPill'

interface SkillSectionProps {
  title: string
  skills: string[]
  variant: 'required' | 'preferred' | 'tech'
}

export function SkillSection({ title, skills, variant }: SkillSectionProps) {
  if (!skills || skills.length === 0) {
    return null
  }

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1">{title}</p>
      <div className="flex flex-wrap gap-1">
        {skills.map((skill) => (
          <SkillPill key={skill} label={skill} variant={variant} />
        ))}
      </div>
    </div>
  )
}
