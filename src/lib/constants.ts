// FAMMS Constants

import type { DowntimeImpact } from '@/types'

// SLA response time targets (minutes) by downtime impact
export const SLA_MINUTES: Record<DowntimeImpact, number> = {
  A: 15,   // Factory Stop — Critical
  B: 30,   // Production Line Stop — High
  C: 120,  // Reduced Capacity — Medium
  D: 1440, // No Impact — Low
}

export const SLA_LABELS: Record<DowntimeImpact, string> = {
  A: '緊急 (15 分鐘)',
  B: '高 (30 分鐘)',
  C: '中 (2 小時)',
  D: '低 (24 小時)',
}

// Observation periods (days) after repair before closing
export const OBSERVATION_PERIODS = [3, 7, 30] as const

// Repeat failure detection window (days)
export const REPEAT_FAILURE_WINDOW_DAYS = 30

// RCA trigger: same failure code N times within window
export const RCA_TRIGGER_COUNT = 3
export const RCA_TRIGGER_WINDOW_DAYS = 90

// Currency
export const CURRENCY = 'IDR'

export const MAX_PHOTOS_PER_STAGE = 6
export const MAX_FILE_SIZE_MB = 10
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(amount)
}
