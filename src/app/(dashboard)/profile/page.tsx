'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Profile, Factory, ROLE_LABELS } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, User } from 'lucide-react'

export default function ProfilePage() {
  const supabase = createClient()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [factories, setFactories] = useState<Factory[]>([])
  const [fullName, setFullName] = useState('')
  const [factoryId, setFactoryId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [{ data: p }, { data: facs }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('factories').select('*').order('name'),
      ])
      setProfile(p)
      setFullName(p?.full_name ?? '')
      setFactoryId(p?.factory_id ?? '')
      setFactories(facs ?? [])
    }
    load()
  }, [])

  async function save() {
    if (!profile) return
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), factory_id: factoryId || null })
      .eq('id', profile.id)
    setSaving(false)
    if (error) toast.error(error.message)
    else toast.success('Profil berhasil disimpan')
  }

  if (!profile) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Profil</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-4 mb-2">
          <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center">
            <User className="w-7 h-7 text-blue-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">{profile.full_name}</p>
            <p className="text-xs text-blue-600 mt-0.5">{ROLE_LABELS[profile.role]}</p>
          </div>
        </div>

        <div>
          <Label htmlFor="name">Nama Lengkap</Label>
          <Input id="name" value={fullName} onChange={e => setFullName(e.target.value)} className="mt-1" />
        </div>

        <div>
          <Label>Pabrik</Label>
          <Select value={factoryId} onValueChange={(v) => setFactoryId(v ?? '')}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih pabrik" /></SelectTrigger>
            <SelectContent>
              {factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Role</Label>
          <p className="mt-1 text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
            {ROLE_LABELS[profile.role]} — Hubungi admin untuk ubah role
          </p>
        </div>

        <Button onClick={save} disabled={saving} className="w-full">
          {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Simpan
        </Button>
      </div>
    </div>
  )
}
