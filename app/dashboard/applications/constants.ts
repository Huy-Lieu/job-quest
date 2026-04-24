import { ApplicationStatus } from '@/lib/types'

export const ALL_STATUSES: ApplicationStatus[] = [
  'saved', 'applied', 'phone_screen', 'interview', 'offer', 'rejected', 'withdrawn',
]

export const INITIAL_FORM_STATE = {
  company: '',
  title: '',
  location: '',
  url: '',
  job_type: 'full_time',
  status: 'applied' as ApplicationStatus,
  notes: '',
}

export type ApplicationFormState = typeof INITIAL_FORM_STATE
