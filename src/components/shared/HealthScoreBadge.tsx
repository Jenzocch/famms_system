import { getHealthScoreBadge } from '@/types'

export default function HealthScoreBadge({ score, showLabel = true }: { score: number; showLabel?: boolean }) {
  const { label, color } = getHealthScoreBadge(score)
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-white text-xs font-bold ${color}`}>
        {score}
      </span>
      {showLabel && <span className="text-sm font-medium text-gray-700">{label}</span>}
    </span>
  )
}
