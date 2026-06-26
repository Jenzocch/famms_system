'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ChevronRight, UserCheck, Lock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhTW } from 'date-fns/locale'
import type { IncidentStatus, UserRole } from '@/types'
import {
  ISSUE_TYPE_LABELS, URGENCY_FROM_IMPACT, STATUS_ZH, STATUS_ZH_COLOR, BOARD_FILTERS,
} from '@/lib/incident-display'
import { PERMISSIONS } from '@/lib/auth'

export interface BoardRow {
  id: string
  incident_no: string
  status: IncidentStatus
  downtime_impact: 'A' | 'B' | 'C' | 'D'
  incident_type: string
  title: string | null
  reporter_name: string | null
  reported_at: string
  assigned_to: string | null
  due_date: string | null
  machine: { machine_code: string | null; machine_name: string } | null
  factory: { name: string } | null
}

interface IncidentBoardProps {
  rows: BoardRow[]
  userRole?: UserRole
}

export default function IncidentBoard({ rows, userRole = 'technician' }: IncidentBoardProps) {
  const [filter, setFilter] = useState('all')
  const canAssign = PERMISSIONS.assignIncident(userRole)

  const activeFilter = BOARD_FILTERS.find(f => f.key === filter)!
  const filtered = activeFilter.statuses
    ? rows.filter(r => activeFilter.statuses!.includes(r.status))
    : rows

  function countFor(statuses: IncidentStatus[] | null) {
    if (!statuses) return rows.length
    return rows.filter(r => statuses.includes(r.status)).length
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-900">案件看板</h1>

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {BOARD_FILTERS.map(f => {
          const n = countFor(f.statuses)
          const active = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                active ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'
              }`}
            >
              {f.label}
              <span className={`ml-1 ${active ? 'text-blue-100' : 'text-gray-400'}`}>{n}</span>
            </button>
          )
        })}
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <AlertCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">沒有案件</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(inc => {
            const urgency = URGENCY_FROM_IMPACT[inc.downtime_impact]
            return (
              <Link
                key={inc.id}
                href={`/incidents/${inc.id}`}
                className="block bg-white rounded-xl border border-gray-200 p-3 active:bg-gray-50"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_ZH_COLOR[inc.status]}`}>
                    {STATUS_ZH[inc.status]}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${urgency.color}`}>
                    {urgency.label}
                  </span>
                  <span className="text-xs text-gray-400 font-mono ml-auto">{inc.incident_no}</span>
                </div>

                <p className="font-medium text-gray-900 mt-2 line-clamp-1">
                  {inc.title || ISSUE_TYPE_LABELS[inc.incident_type] || '問題'}
                </p>

                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-gray-500 truncate">
                    {ISSUE_TYPE_LABELS[inc.incident_type] || inc.incident_type}
                    {inc.factory ? ` · ${inc.factory.name}` : ''}
                    {inc.machine ? ` · ${inc.machine.machine_name}` : ''}
                  </p>
                  <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                </div>

                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-gray-400">
                    {inc.reporter_name ? `${inc.reporter_name} · ` : ''}
                    {formatDistanceToNow(new Date(inc.reported_at), { addSuffix: true, locale: zhTW })}
                  </p>
                  {inc.status !== 'closed' && (
                    inc.assigned_to ? (
                      <span className="inline-flex items-center gap-0.5 text-xs text-blue-600">
                        <UserCheck className="w-3 h-3" /> {inc.assigned_to}
                      </span>
                    ) : canAssign ? (
                      <span className="text-xs text-amber-600">未指派</span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-xs text-gray-400" title="只有主管可以派工">
                        <Lock className="w-3 h-3" /> 未指派
                      </span>
                    )
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
