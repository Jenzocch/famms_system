'use client'

import { useI18n } from '@/lib/i18n'

export function SettingsHeading() {
  const { t } = useI18n()
  return <h1 className="text-xl font-bold text-gray-900">{t('settings.title')}</h1>
}

export function SettingsSectionHeader({
  titleKey,
  descKey,
}: {
  titleKey: string
  descKey: string
}) {
  const { t } = useI18n()
  return (
    <div>
      <h2 className="font-semibold text-gray-900">{t(titleKey)}</h2>
      <p className="text-xs text-gray-500 mt-0.5">{t(descKey)}</p>
    </div>
  )
}

export function NoFactoryMessage() {
  const { t } = useI18n()
  return <p className="text-sm text-gray-500">{t('settings.noFactoryForAccount')}</p>
}
