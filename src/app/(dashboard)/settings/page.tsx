import { redirect } from 'next/navigation'
import { getCurrentUser, PERMISSIONS } from '@/lib/auth'
import TelegramSettings from '@/components/settings/TelegramSettings'
import FactoryManager from '@/components/settings/FactoryManager'
import AreaManager from '@/components/settings/AreaManager'
import AssetManager from '@/components/settings/AssetManager'
import IncidentTypeManager from '@/components/settings/IncidentTypeManager'
import PMScheduleManager from '@/components/settings/PMScheduleManager'
import UserManager from '@/components/settings/UserManager'
import { isTelegramConfigured } from '@/lib/telegram'
import {
  SettingsHeading,
  SettingsSectionHeader,
  NoFactoryMessage,
} from '@/components/settings/SettingsSectionHeader'

export const metadata = { title: 'Settings | FAMMS' }

export default async function SettingsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Technicians / supervisors / directors have no settings to manage —
  // keep them out of the page entirely (defence in depth alongside nav gating).
  if (!PERMISSIONS.viewSettings(user.role)) redirect('/dashboard')

  const canManageUsers = PERMISSIONS.manageUsers(user.role)
  const canManageMachines = PERMISSIONS.manageMachines(user.role)
  const canManageAreas = PERMISSIONS.manageAreas(user.role)
  const canManageFactories = PERMISSIONS.manageFactories(user.role)
  const canManageIncidentTypes = PERMISSIONS.manageIncidentTypes(user.role)
  const canManagePMSchedules = PERMISSIONS.managePMSchedules(user.role)
  const canManageTelegram = PERMISSIONS.manageTelegram(user.role)

  return (
    <div className="space-y-5">
      <SettingsHeading />

      {/* User Management — admin only */}
      {canManageUsers && (
        <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <SettingsSectionHeader titleKey="settings.userSectionTitle" descKey="settings.userSectionDesc" />
          <UserManager currentUserId={user.id} />
        </section>
      )}

      {/* Asset Management — manager + admin */}
      {canManageMachines && (
        <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <SettingsSectionHeader titleKey="settings.assetSectionTitle" descKey="settings.assetSectionDesc" />
          <AssetManager />
        </section>
      )}

      {/* Area Management — manager + admin */}
      {canManageAreas && (
        <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <SettingsSectionHeader titleKey="settings.areaSectionTitle" descKey="settings.areaSectionDesc" />
          <AreaManager />
        </section>
      )}

      {/* Factory Management — manager + admin */}
      {canManageFactories && (
        <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <SettingsSectionHeader titleKey="settings.factorySectionTitle" descKey="settings.factorySectionDesc" />
          <FactoryManager />
        </section>
      )}

      {/* Incident Type Management — manager + admin */}
      {canManageIncidentTypes && (
        <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <SettingsSectionHeader titleKey="settings.incidentTypeSectionTitle" descKey="settings.incidentTypeSectionDesc" />
          <IncidentTypeManager />
        </section>
      )}

      {/* PM Schedule Management — admin only */}
      {canManagePMSchedules && (
        <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <SettingsSectionHeader titleKey="settings.pmSectionTitle" descKey="settings.pmSectionDesc" />
          <PMScheduleManager />
        </section>
      )}

      {/* Telegram Notifications — manager + admin */}
      {canManageTelegram && (
        <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <SettingsSectionHeader titleKey="settings.telegramSectionTitle" descKey="settings.telegramSectionDesc" />
          {user.factory_id ? (
            <TelegramSettings factoryId={user.factory_id} configured={isTelegramConfigured()} />
          ) : (
            <NoFactoryMessage />
          )}
        </section>
      )}
    </div>
  )
}
