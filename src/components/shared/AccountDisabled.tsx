'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { ShieldX } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

export default function AccountDisabled() {
  const router = useRouter()
  const supabase = createClient()
  const { t } = useI18n()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-red-100 rounded-2xl mb-4">
          <ShieldX className="w-7 h-7 text-red-600" />
        </div>
        <h1 className="text-lg font-bold text-gray-900">{t('accountDisabled.title', '帳號已停用')}</h1>
        <p className="text-sm text-gray-500 mt-2">
          {t('accountDisabled.desc', '此帳號目前無法使用，請聯絡系統管理員。')}
        </p>
        <Button onClick={signOut} className="w-full mt-6">{t('accountDisabled.logout', '登出')}</Button>
      </div>
    </div>
  )
}
