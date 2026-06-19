import { RequestStatus, UserRole } from '@/types'
import { CheckCircle, Clock, Circle } from 'lucide-react'

interface ApprovalRecord {
  action: string
  role: string
  comment: string | null
  created_at: string
  approver?: { full_name: string }
}

interface Props {
  status: RequestStatus
  estimatedCost: number
  approvals: ApprovalRecord[]
}

const STAGES: { role: UserRole; label: string; minAmount: number }[] = [
  { role: 'dept_manager', label: 'Dept. Manager', minAmount: 0 },
  { role: 'general_manager', label: 'General Manager', minAmount: 5_000_001 },
  { role: 'director', label: 'Director', minAmount: 20_000_001 },
]

export default function ApprovalProgress({ status, estimatedCost, approvals }: Props) {
  const activeStages = STAGES.filter(s => estimatedCost >= s.minAmount)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Approval Progress</p>
      <div className="flex items-center gap-0">
        {activeStages.map((stage, i) => {
          const approval = approvals.find(a => a.role === stage.role && a.action === 'approve')
          const rejected = approvals.find(a => a.role === stage.role && (a.action === 'reject' || a.action === 'return'))
          const isCurrent = status === `pending_${stage.role}`
          const isDone = !!approval
          const isFailed = !!rejected && !isDone

          return (
            <div key={stage.role} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  isDone ? 'bg-green-100 text-green-600' :
                  isFailed ? 'bg-red-100 text-red-500' :
                  isCurrent ? 'bg-blue-100 text-blue-600 ring-2 ring-blue-400 ring-offset-1' :
                  'bg-gray-100 text-gray-400'
                }`}>
                  {isDone ? <CheckCircle className="w-4 h-4" /> :
                   isCurrent ? <Clock className="w-4 h-4" /> :
                   <Circle className="w-4 h-4" />}
                </div>
                <p className={`text-xs mt-1 text-center font-medium leading-tight ${
                  isDone ? 'text-green-700' :
                  isCurrent ? 'text-blue-700' :
                  'text-gray-400'
                }`}>{stage.label}</p>
                {isDone && approval && (
                  <p className="text-xs text-gray-400 text-center leading-tight">{approval.approver?.full_name}</p>
                )}
                {isCurrent && (
                  <p className="text-xs text-blue-500 text-center font-medium">Pending</p>
                )}
              </div>
              {i < activeStages.length - 1 && (
                <div className={`h-0.5 w-6 mx-1 shrink-0 -mt-5 ${isDone ? 'bg-green-400' : 'bg-gray-200'}`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
