'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Loader2, UserCheck } from 'lucide-react'

export default function AssignForm({
  incidentId, assignedTo, assignedDept, dueDate,
}: {
  incidentId: string
  assignedTo: string | null
  assignedDept: string | null
  dueDate: string | null
}) {
  const router = useRouter()
  const supabase = createClient()

  const [person, setPerson] = useState(assignedTo || '')
  const [dept, setDept] = useState(assignedDept || '')
  const [due, setDue] = useState(dueDate || '')
  const [submitting, setSubmitting] = useState(false)

  async function save() {
    setSubmitting(true)
    try {
      const { error } = await supabase
        .from('incidents')
        .update({
          assigned_to: person || null,
          assigned_dept: dept || null,
          due_date: due || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', incidentId)
      if (error) throw error
      toast.success('派工已更新')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失敗')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900 flex items-center gap-1.5">
        <UserCheck className="w-4 h-4" /> 派工指派
      </h3>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>負責人</Label>
          <Input
            value={person}
            onChange={e => setPerson(e.target.value)}
            placeholder="維修人員"
            className="mt-1"
          />
        </div>
        <div>
          <Label>部門</Label>
          <Input
            value={dept}
            onChange={e => setDept(e.target.value)}
            placeholder="如：機電課"
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <Label>預計完成日</Label>
        <Input type="date" value={due} onChange={e => setDue(e.target.value)} className="mt-1" />
      </div>

      <Button onClick={save} disabled={submitting} variant="outline" className="w-full">
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        儲存派工
      </Button>
    </div>
  )
}
