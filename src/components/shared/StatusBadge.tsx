import { RequestStatus, STATUS_LABELS, STATUS_COLORS } from '@/types'
import { cn } from '@/lib/utils'

export default function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className={cn('inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold', STATUS_COLORS[status])}>
      {STATUS_LABELS[status]}
    </span>
  )
}
