// lib/constants.ts
// Shared application-level constants (badge definitions, status labels/colors).
// Kept separate from lib/types.ts so types.ts stays pure type declarations.

import type { ApplicationStatus } from './types'

export const BADGE_DEFINITIONS: Record<string, { label: string; description: string; icon: string }> = {
  first_save:        { label: 'First Save',        description: 'Saved your first job listing',         icon: '🔖' },
  first_application: { label: 'First Application', description: 'Submitted your first job application', icon: '📨' },
  five_applications: { label: 'High Five',          description: 'Applied to 5 jobs',                    icon: '✋' },
  ten_applications:  { label: 'On a Roll',          description: 'Applied to 10 jobs',                   icon: '🔥' },
  first_interview:   { label: 'Interview Landed',   description: 'Got your first interview',             icon: '🎤' },
  first_offer:       { label: 'Offer Received',     description: 'Received your first job offer',        icon: '🏆' },
  streak_3:          { label: '3-Day Streak',        description: 'Applied 3 days in a row',             icon: '⚡' },
  streak_7:          { label: 'Week Warrior',        description: 'Applied 7 days in a row',             icon: '📅' },
}

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved:        'Saved',
  applied:      'Applied',
  phone_screen: 'Phone Screen',
  interview:    'Interview',
  offer:        'Offer',
  rejected:     'Rejected',
  withdrawn:    'Withdrawn',
}

export const STATUS_COLORS: Record<ApplicationStatus, string> = {
  saved:        'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300',
  applied:      'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  phone_screen: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300',
  interview:    'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  offer:        'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  rejected:     'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  withdrawn:    'bg-gray-100 text-gray-500 dark:bg-gray-500/10 dark:text-gray-400',
}
