'use client'

import { useState } from 'react'
import { LayoutGrid, Search } from 'lucide-react'
import IncidentBoard, { BoardRow } from './IncidentBoard'
import IncidentSearch from './IncidentSearch'
import type { UserRole } from '@/types'
import { useI18n } from '@/lib/i18n'

interface IncidentsBoardWithSearchProps {
  rows: BoardRow[]
  userRole?: UserRole
}

export default function IncidentsBoardWithSearch({
  rows,
  userRole = 'technician',
}: IncidentsBoardWithSearchProps) {
  const { t } = useI18n()
  const [view, setView] = useState<'board' | 'search'>('board')

  return (
    <div className="space-y-4">
      {/* View Toggle Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setView('board')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            view === 'board'
              ? 'text-blue-600 border-blue-600'
              : 'text-gray-600 border-transparent hover:text-gray-900'
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          {t('board.tabBoard')}
        </button>
        <button
          onClick={() => setView('search')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            view === 'search'
              ? 'text-blue-600 border-blue-600'
              : 'text-gray-600 border-transparent hover:text-gray-900'
          }`}
        >
          <Search className="w-4 h-4" />
          {t('board.tabSearch')}
        </button>
      </div>

      {/* Board View */}
      {view === 'board' && (
        <IncidentBoard rows={rows} userRole={userRole} />
      )}

      {/* Search View */}
      {view === 'search' && (
        <div className="space-y-4">
          <h2 className="text-sm text-gray-600">{t('board.searchSubtitle')}</h2>
          <IncidentSearch />
        </div>
      )}
    </div>
  )
}
