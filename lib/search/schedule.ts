import { SearchConfig } from '@/lib/types'

export const INTERVAL_MS: Record<string, number> = {
  daily:  24 * 60 * 60 * 1000,
  '6h':    6 * 60 * 60 * 1000,
  manual: Infinity,   // never auto-triggered
}

export function isDue(config: SearchConfig): boolean {
  if (config.schedule_interval === 'manual') return false
  if (!config.last_run_at) return true   // never run before — always due
  const intervalMs = INTERVAL_MS[config.schedule_interval] ?? INTERVAL_MS.daily
  return Date.now() - new Date(config.last_run_at).getTime() >= intervalMs
}
