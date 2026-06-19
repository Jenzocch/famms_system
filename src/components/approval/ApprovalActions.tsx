'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApprovalAction, RequestStatus, UserRole } from '@/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { CheckCircle, XCircle, RotateCcw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  requestId: string
  status: RequestStatus
  myRole: UserRole
  currentApproverRole: UserRole | null
  compact?: boolean
}

export default function ApprovalActions({ requestId, status, myRole, currentApproverRole, compact }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState<ApprovalAction | null>(null)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)

  const canAct = currentApproverRole === myRole &&
    ['pending_dept_manager', 'pending_general_manager', 'pending_director'].includes(status)

  if (!canAct) return null

  async function submit(action: ApprovalAction) {
    if ((action === 'reject' || action === 'return') && !comment.trim()) {
      toast.error('Please provide a reason')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action, comment: comment.trim() || null }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const { status: newStatus } = await res.json()
      toast.success(
        action === 'approve' ? (newStatus === 'approved' ? '✅ Fully Approved!' : '✅ Passed to next approver') :
        action === 'reject' ? '❌ Request Rejected' : '↩️ Returned to Applicant'
      )
      setOpen(null)
      setComment('')
      router.refresh()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className={compact ? '' : 'bg-white rounded-xl border-2 border-blue-200 p-4'}>
        {!compact && <p className="text-sm font-semibold text-blue-800 mb-3">Your Approval Required</p>}
        <div className="flex gap-2">
          <Button onClick={() => setOpen('approve')} className="flex-1 bg-green-600 hover:bg-green-700">
            <CheckCircle className="w-4 h-4 mr-1" /> Approve
          </Button>
          <Button onClick={() => setOpen('return')} variant="outline" className="flex-1 border-orange-300 text-orange-700 hover:bg-orange-50">
            <RotateCcw className="w-4 h-4 mr-1" /> Return
          </Button>
          <Button onClick={() => setOpen('reject')} variant="outline" className="flex-1 border-red-300 text-red-700 hover:bg-red-50">
            <XCircle className="w-4 h-4 mr-1" /> Reject
          </Button>
        </div>
      </div>

      <Dialog open={!!open} onOpenChange={() => { setOpen(null); setComment('') }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {open === 'approve' && '✅ Approve Request'}
              {open === 'return' && '↩️ Return to Applicant'}
              {open === 'reject' && '❌ Reject Request'}
            </DialogTitle>
          </DialogHeader>
          <div>
            <label className="text-sm font-medium text-gray-700">
              Comment {(open === 'reject' || open === 'return') && <span className="text-red-500">*</span>}
            </label>
            <Textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder={open === 'approve' ? 'Optional comment...' : 'Reason required...'}
              rows={3} className="mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(null); setComment('') }}>Cancel</Button>
            <Button
              onClick={() => open && submit(open)}
              disabled={loading}
              className={open === 'approve' ? 'bg-green-600 hover:bg-green-700' : open === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-600 hover:bg-orange-700'}
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
