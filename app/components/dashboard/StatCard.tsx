'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Send, CalendarCheck, Briefcase, Trophy } from 'lucide-react'

const ICON_MAP = {
  Send,
  CalendarCheck,
  Briefcase,
  Trophy,
} as const

export type StatCardIcon = keyof typeof ICON_MAP

interface StatCardProps {
  title:       string
  value:       string | number
  icon:        StatCardIcon
  description: string
  trend?:      'up' | 'down' | 'neutral'
}

export function StatCard({ title, value, icon, description }: StatCardProps) {
  const Icon = ICON_MAP[icon]
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  )
}
