'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2, Send, MessageCircle, UserCheck } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface Group {
  id: string
  name: string
  telegram_group_id: number
  notify_new_incident: boolean
  notify_sla_alert: boolean
  notify_blocking: boolean
  notify_daily_summary: boolean
}

interface Account {
  id: string
  full_name: string | null
  role: string
  factory_id: string | null
}

interface PersonalUser {
  id: string
  profile_id: string
  telegram_chat_id: number
  notification_enabled: boolean
}

export default function TelegramSettings({
  factoryId,
  configured,
}: {
  factoryId: string
  configured: boolean
}) {
  const { t } = useI18n()
  const supabase = createClient()
  const [groups, setGroups] = useState<Group[]>([])
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  // Personal (per-account) Telegram notifications — so a reminder to a specific
  // assignee (QC, technician…) can DM that person directly, not just the group.
  const [accounts, setAccounts] = useState<Account[]>([])
  const [users, setUsers] = useState<PersonalUser[]>([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [chatId, setChatId] = useState('')
  const [savingUser, setSavingUser] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('telegram_groups')
      .select('*')
      .eq('factory_id', factoryId)
      .order('created_at')
    setGroups(data ?? [])
  }

  async function loadPeople() {
    // Assignable accounts: this factory's users + cross-factory (null factory).
    const { data: accts } = await supabase
      .from('profiles')
      .select('id, full_name, role, factory_id')
      .eq('is_active', true)
      .order('full_name')
    setAccounts(
      ((accts ?? []) as Account[]).filter(
        a => !a.factory_id || a.factory_id === factoryId
      )
    )

    // Include NULL-factory rows: cross-factory accounts (admins) register
    // without a factory, and this list is the only place to manage them.
    const { data: regs } = await supabase
      .from('telegram_users')
      .select('id, profile_id, telegram_chat_id, notification_enabled')
      .or(`factory_id.eq.${factoryId},factory_id.is.null`)
    setUsers((regs ?? []) as PersonalUser[])
  }

  useEffect(() => {
    load()
    loadPeople()
  }, [])

  async function addGroup() {
    if (!name || !groupId) {
      toast.error(t('telegram.fillNameAndId'))
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('telegram_groups').insert({
        factory_id: factoryId,
        name,
        telegram_group_id: Number(groupId),
      })
      if (error) throw error
      toast.success(t('telegram.groupAdded'))
      setName(''); setGroupId('')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('telegram.addGroupFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function toggleFlag(g: Group, flag: keyof Group) {
    const next = !g[flag]
    const { error } = await supabase
      .from('telegram_groups')
      .update({ [flag]: next })
      .eq('id', g.id)
    if (error) {
      toast.error(t('telegram.updateFailed'))
      return
    }
    setGroups(groups.map(x => (x.id === g.id ? { ...x, [flag]: next } : x)))
  }

  async function removeGroup(id: string) {
    const { error } = await supabase.from('telegram_groups').delete().eq('id', id)
    if (error) {
      toast.error(t('telegram.deleteFailed'))
      return
    }
    setGroups(groups.filter(g => g.id !== id))
    toast.success(t('telegram.groupDeleted'))
  }

  async function testSend() {
    setTesting(true)
    try {
      const res = await fetch('/api/notifications/test', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t('telegram.testFailed'))
      toast.success(t('telegram.testSent').replace('{sent}', String(json.sent)).replace('{failed}', String(json.failed)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('telegram.testFailed'))
    } finally {
      setTesting(false)
    }
  }

  async function addUser() {
    if (!selectedProfile || !chatId) {
      toast.error(t('telegram.fillUserAndId', '請選擇帳號並填入 Chat ID'))
      return
    }
    setSavingUser(true)
    try {
      const { error } = await supabase.from('telegram_users').insert({
        factory_id: factoryId,
        profile_id: selectedProfile,
        telegram_chat_id: Number(chatId),
      })
      if (error) throw error
      toast.success(t('telegram.userAdded', '個人通知已新增'))
      setSelectedProfile(''); setChatId('')
      loadPeople()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('telegram.addUserFailed', '新增個人通知失敗'))
    } finally {
      setSavingUser(false)
    }
  }

  async function toggleUser(u: PersonalUser) {
    const next = !u.notification_enabled
    const { error } = await supabase
      .from('telegram_users')
      .update({ notification_enabled: next })
      .eq('id', u.id)
    if (error) {
      toast.error(t('telegram.updateFailed'))
      return
    }
    setUsers(users.map(x => (x.id === u.id ? { ...x, notification_enabled: next } : x)))
  }

  async function removeUser(id: string) {
    const { error } = await supabase.from('telegram_users').delete().eq('id', id)
    if (error) {
      toast.error(t('telegram.deleteFailed'))
      return
    }
    setUsers(users.filter(u => u.id !== id))
    toast.success(t('telegram.userDeleted', '個人通知已刪除'))
  }

  const accountLabel = (id: string) => {
    const a = accounts.find(x => x.id === id)
    return a ? (a.full_name || `(${a.role})`) : id.slice(0, 8)
  }

  // Accounts not yet registered for personal notifications (for the dropdown).
  const unregisteredAccounts = accounts.filter(
    a => !users.some(u => u.profile_id === a.id)
  )

  const FLAGS: { key: keyof Group; label: string }[] = [
    { key: 'notify_new_incident', label: t('telegram.flagNewIncident') },
    { key: 'notify_sla_alert', label: t('telegram.flagSlaAlert') },
    { key: 'notify_blocking', label: t('telegram.flagBlocking') },
    { key: 'notify_daily_summary', label: t('telegram.flagDailySummary') },
  ]

  return (
    <div className="space-y-6">
      {/* Status */}
      <div className={`rounded-xl border p-4 ${configured ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
        <div className="flex items-center gap-2">
          <MessageCircle className={`w-5 h-5 ${configured ? 'text-green-600' : 'text-amber-600'}`} />
          <p className={`text-sm font-medium ${configured ? 'text-green-800' : 'text-amber-800'}`}>
            {configured
              ? t('telegram.configured')
              : t('telegram.notConfigured')}
          </p>
        </div>
      </div>

      {/* How to get a Group ID — numbered steps for first-time admins */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h3 className="font-semibold text-blue-900 text-sm mb-3">{t('telegram.howToTitle')}</h3>
        <ol className="space-y-2">
          {[t('telegram.step1'), t('telegram.step2'), t('telegram.step3')].map((step, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-blue-800">
              <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Add group */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="font-semibold text-gray-900">{t('telegram.addGroup')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>{t('telegram.groupName')}</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Maintenance DIN" className="mt-1" />
          </div>
          <div>
            <Label>{t('telegram.groupId')}</Label>
            <Input value={groupId} onChange={e => setGroupId(e.target.value)} placeholder="-1001234567890" className="mt-1" />
          </div>
        </div>
        <Button onClick={addGroup} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
          {t('telegram.addGroupBtn')}
        </Button>
      </div>

      {/* Group list */}
      {groups.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {groups.map(g => (
            <div key={g.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{g.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{g.telegram_group_id}</p>
                </div>
                <button onClick={() => removeGroup(g.id)} className="text-gray-400 hover:text-red-500">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {FLAGS.map(f => (
                  <button
                    key={f.key}
                    onClick={() => toggleFlag(g, f.key)}
                    className={`text-xs px-3 py-1 rounded-full border transition ${
                      g[f.key]
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-gray-50 border-gray-200 text-gray-400'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Personal notifications — DM a specific assignee (QC / technician) */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-1.5">
            <UserCheck className="w-4 h-4" /> {t('telegram.personalTitle', '個人通知帳號')}
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            {t('telegram.personalDesc', '登錄員工的個人 Chat ID。當工單指派給他並被催進度時，會直接私訊本人。')}
          </p>
        </div>

        {/* How to get a personal Chat ID */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
          <p>{t('telegram.personalStep1', '1. 員工在 Telegram 私訊 FAMMS bot，傳送 /start')}</p>
          <p>{t('telegram.personalStep2', '2. bot 回覆「Chat ID Anda: 數字」')}</p>
          <p>{t('telegram.personalStep3', '3. 選擇下方帳號，把該數字填進 Chat ID 後新增')}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>{t('telegram.account', '帳號')}</Label>
            <select
              value={selectedProfile}
              onChange={e => setSelectedProfile(e.target.value)}
              className="mt-1 w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm"
            >
              <option value="">{t('telegram.selectAccount', '— 選擇帳號 —')}</option>
              {unregisteredAccounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.full_name || `(${a.role})`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>{t('telegram.personalChatId', '個人 Chat ID')}</Label>
            <Input value={chatId} onChange={e => setChatId(e.target.value)} placeholder="5003966994" className="mt-1" />
          </div>
        </div>
        <Button onClick={addUser} disabled={savingUser}>
          {savingUser ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
          {t('telegram.addUserBtn', '新增個人通知')}
        </Button>

        {/* Registered personal users */}
        {users.length > 0 && (
          <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
            {users.map(u => (
              <div key={u.id} className="flex items-center justify-between p-3">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{accountLabel(u.profile_id)}</p>
                  <p className="text-xs text-gray-400 font-mono">{u.telegram_chat_id}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleUser(u)}
                    className={`text-xs px-3 py-1 rounded-full border transition ${
                      u.notification_enabled
                        ? 'bg-green-50 border-green-300 text-green-700'
                        : 'bg-gray-50 border-gray-200 text-gray-400'
                    }`}
                  >
                    {u.notification_enabled ? t('telegram.enabled', '已啟用') : t('telegram.disabled', '已停用')}
                  </button>
                  <button onClick={() => removeUser(u.id)} className="text-gray-400 hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Test */}
      <Button variant="outline" onClick={testSend} disabled={testing || !configured}>
        {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
        {t('telegram.sendTest')}
      </Button>
    </div>
  )
}
