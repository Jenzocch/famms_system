import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TelegramSettings from '@/components/settings/TelegramSettings'
import FactoryManager from '@/components/settings/FactoryManager'
import AreaManager from '@/components/settings/AreaManager'
import AssetManager from '@/components/settings/AssetManager'
import { isTelegramConfigured } from '@/lib/telegram'

export const metadata = { title: '設定 | 維修系統' }

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('factory_id')
    .eq('id', user.id)
    .single()

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-gray-900">設定</h1>

      {/* Asset Management */}
      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div>
          <h2 className="font-semibold text-gray-900">機器/項目管理</h2>
          <p className="text-xs text-gray-500 mt-0.5">依工廠、區域新增或刪除機器與項目</p>
        </div>
        <AssetManager />
      </section>

      {/* Area Management */}
      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div>
          <h2 className="font-semibold text-gray-900">區域管理</h2>
          <p className="text-xs text-gray-500 mt-0.5">為每個工廠新增、編輯或刪除區域</p>
        </div>
        <AreaManager />
      </section>

      {/* Factory Management */}
      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div>
          <h2 className="font-semibold text-gray-900">工廠管理</h2>
          <p className="text-xs text-gray-500 mt-0.5">新增、編輯或刪除工廠</p>
        </div>
        <FactoryManager />
      </section>

      {/* Telegram Notifications */}
      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div>
          <h2 className="font-semibold text-gray-900">Telegram 通知</h2>
          <p className="text-xs text-gray-500 mt-0.5">有新報修時發送通知</p>
        </div>
        {profile?.factory_id ? (
          <TelegramSettings factoryId={profile.factory_id} configured={isTelegramConfigured()} />
        ) : (
          <p className="text-sm text-gray-500">找不到此帳戶的工廠。</p>
        )}
      </section>
    </div>
  )
}
