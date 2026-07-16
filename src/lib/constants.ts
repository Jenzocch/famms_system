// FAMMS Constants

import type { DowntimeImpact } from '@/types'

// SLA response time targets (minutes) by downtime impact
export const SLA_MINUTES: Record<DowntimeImpact, number> = {
  A: 15,   // Factory Stop — Critical
  C: 120,  // Reduced Capacity — Medium
  D: 1440, // No Impact — Low
}

export const SLA_LABELS: Record<DowntimeImpact, string> = {
  A: 'Critical (15 menit)',
  C: 'Medium (2 jam)',
  D: 'Low (24 jam)',
}

// Observation periods (days) after repair before closing
export const OBSERVATION_PERIODS = [3, 7, 30] as const

// Repeat failure detection window (days)
export const REPEAT_FAILURE_WINDOW_DAYS = 30

// RCA trigger: same failure code N times within window
export const RCA_TRIGGER_COUNT = 3
export const RCA_TRIGGER_WINDOW_DAYS = 90

export const MAX_PHOTOS_PER_STAGE = 6
export const MAX_FILE_SIZE_MB = 10
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Default warehouse per factory (factories.code) for the parts-request form.
// Only confirmed mappings go here — unlisted factories fall back to a free-text
// field so we never guess a warehouse name that hasn't been verified.
export const WAREHOUSE_BY_FACTORY_CODE: Record<string, string> = {
  DIN: 'HARDWARE',
}
