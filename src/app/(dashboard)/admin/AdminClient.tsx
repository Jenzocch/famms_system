'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Department, Profile, UserRole, ROLE_LABELS } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2, Pencil, Check, X } from 'lucide-react'

interface Props {
  departments: Department[]
  profiles: (Profile & { department?: Department })[]
}

const ROLES: UserRole[] = ['applicant', 'dept_manager', 'general_manager', 'director', 'purchasing']

export default function AdminClient({ departments: initDepts, profiles: initProfiles }: Props) {
  const supabase = createClient()

  const [departments, setDepartments] = useState(initDepts)
  const [newDeptName, setNewDeptName] = useState('')
  const [editingDept, setEditingDept] = useState<{ id: string; name: string } | null>(null)
  const [deptLoading, setDeptLoading] = useState(false)

  const [profiles, setProfiles] = useState(initProfiles)
  const [editingProfile, setEditingProfile] = useState<string | null>(null)
  const [profileEdits, setProfileEdits] = useState<{ full_name: string; role: UserRole; department_id: string }>({ full_name: '', role: 'applicant', department_id: '' })
  const [profileLoading, setProfileLoading] = useState(false)

  async function addDept() {
    if (!newDeptName.trim()) return
    setDeptLoading(true)
    const { data, error } = await supabase.from('departments').insert({ name: newDeptName.trim() }).select().single()
    setDeptLoading(false)
    if (error) { toast.error(error.message); return }
    setDepartments(d => [...d, data])
    setNewDeptName('')
    toast.success('Department added')
  }

  async function saveDept() {
    if (!editingDept) return
    setDeptLoading(true)
    const { error } = await supabase.from('departments').update({ name: editingDept.name }).eq('id', editingDept.id)
    setDeptLoading(false)
    if (error) { toast.error(error.message); return }
    setDepartments(d => d.map(x => x.id === editingDept.id ? { ...x, name: editingDept.name } : x))
    setEditingDept(null)
    toast.success('Department updated')
  }

  async function deleteDept(id: string) {
    if (!confirm('Delete this department?')) return
    const { error } = await supabase.from('departments').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setDepartments(d => d.filter(x => x.id !== id))
    toast.success('Department deleted')
  }

  function startEditProfile(p: Profile & { department?: Department }) {
    setEditingProfile(p.id)
    setProfileEdits({ full_name: p.full_name, role: p.role, department_id: p.department_id ?? '' })
  }

  async function saveProfile(id: string) {
    setProfileLoading(true)
    const { error } = await supabase.from('profiles').update({
      full_name: profileEdits.full_name,
      role: profileEdits.role,
      department_id: profileEdits.department_id || null,
    }).eq('id', id)
    setProfileLoading(false)
    if (error) { toast.error(error.message); return }
    setProfiles(p => p.map(x => x.id === id ? {
      ...x,
      full_name: profileEdits.full_name,
      role: profileEdits.role,
      department_id: profileEdits.department_id || null,
      department: departments.find(d => d.id === profileEdits.department_id),
    } : x))
    setEditingProfile(null)
    toast.success('User updated')
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Departments</h2>
        <div className="flex gap-2 mb-4">
          <Input
            placeholder="New department name"
            value={newDeptName}
            onChange={e => setNewDeptName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addDept()}
            className="flex-1"
          />
          <Button onClick={addDept} disabled={deptLoading}>
            {deptLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </Button>
        </div>
        <div className="space-y-2">
          {departments.map(dept => (
            <div key={dept.id} className="flex items-center gap-2 p-3 rounded-lg bg-gray-50">
              {editingDept?.id === dept.id ? (
                <>
                  <Input
                    value={editingDept.name}
                    onChange={e => setEditingDept({ ...editingDept, name: e.target.value })}
                    className="flex-1"
                    autoFocus
                  />
                  <Button size="sm" onClick={saveDept} disabled={deptLoading}><Check className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingDept(null)}><X className="w-4 h-4" /></Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-gray-800">{dept.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => setEditingDept({ id: dept.id, name: dept.name })}><Pencil className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => deleteDept(dept.id)}><Trash2 className="w-4 h-4" /></Button>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Users ({profiles.length})</h2>
        <div className="space-y-3">
          {profiles.map(p => (
            <div key={p.id} className="border border-gray-100 rounded-xl p-4">
              {editingProfile === p.id ? (
                <div className="space-y-3">
                  <div>
                    <Label>Full Name</Label>
                    <Input value={profileEdits.full_name} onChange={e => setProfileEdits(x => ({ ...x, full_name: e.target.value }))} className="mt-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Role</Label>
                      <Select value={profileEdits.role} onValueChange={v => setProfileEdits(x => ({ ...x, role: v as UserRole }))}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ROLES.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Department</Label>
                      <Select value={profileEdits.department_id} onValueChange={v => setProfileEdits(x => ({ ...x, department_id: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setEditingProfile(null)}>Cancel</Button>
                    <Button size="sm" onClick={() => saveProfile(p.id)} disabled={profileLoading}>
                      {profileLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-semibold text-gray-900">{p.full_name}</p>
                    <p className="text-sm text-gray-500">{p.email}</p>
                    <div className="flex gap-2 mt-1">
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{ROLE_LABELS[p.role]}</span>
                      {p.department && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{p.department.name}</span>}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => startEditProfile(p)}><Pencil className="w-4 h-4" /></Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
