import { SupabaseClient } from '@supabase/supabase-js'

// Audit values are heterogeneous by design: some callers log a plain scalar
// (e.g. the old/new status string), others log a partial record of the
// fields that changed (e.g. { title, description, ... }).
export type AuditValue = Record<string, unknown> | string | null

export interface AuditLogEntry {
  id: string
  user_id: string | null
  user_name: string | null
  action_type: string
  resource_type: string
  resource_id: string
  old_value: AuditValue
  new_value: AuditValue
  change_summary: string | null
  timestamp: string
  ip_address: string | null
}

export async function logAuditEvent(
  supabase: SupabaseClient,
  {
    userId,
    userName,
    actionType,
    resourceType,
    resourceId,
    oldValue,
    newValue,
    changeSummary,
    ipAddress,
    factoryId,
  }: {
    userId: string | null
    userName: string | null
    actionType: 'create' | 'update' | 'delete' | 'status_change' | 'assign' | 'comment'
    resourceType: 'incident' | 'machine' | 'pm_schedule' | 'maintenance_log'
    resourceId: string
    oldValue?: AuditValue
    newValue?: AuditValue
    changeSummary?: string
    ipAddress?: string
    factoryId?: string
  },
) {
  try {
    const { error } = await supabase.from('audit_logs').insert({
      user_id: userId,
      user_name: userName,
      action_type: actionType,
      resource_type: resourceType,
      resource_id: resourceId,
      old_value: oldValue || null,
      new_value: newValue || null,
      change_summary: changeSummary,
      ip_address: ipAddress,
      factory_id: factoryId,
    })

    if (error) console.error('Audit log error:', error)
  } catch (err) {
    console.error('Failed to log audit event:', err)
  }
}

export function generateChangeSummary(
  actionType: string,
  oldValue: AuditValue,
  newValue: AuditValue,
): string {
  // Both params may be a plain scalar (status_change) or a partial record
  // of changed fields (update/assign) — narrow to a record before reading
  // named fields off it.
  const oldRec = oldValue && typeof oldValue === 'object' ? oldValue : undefined
  const newRec = newValue && typeof newValue === 'object' ? newValue : undefined

  if (actionType === 'status_change') {
    return `狀態從 "${oldValue}" 變更為 "${newValue}"`
  }

  if (actionType === 'update') {
    const changes: string[] = []
    if (oldRec?.title !== newRec?.title) {
      changes.push(`標題: "${oldRec?.title}" → "${newRec?.title}"`)
    }
    if (oldRec?.status !== newRec?.status) {
      changes.push(`狀態: "${oldRec?.status}" → "${newRec?.status}"`)
    }
    if (oldRec?.description !== newRec?.description) {
      changes.push('描述已更新')
    }
    if (oldRec?.assigned_to !== newRec?.assigned_to) {
      changes.push(`指派: "${oldRec?.assigned_to}" → "${newRec?.assigned_to}"`)
    }
    return changes.length > 0 ? changes.join(' | ') : '已更新'
  }

  if (actionType === 'create') {
    return '工單已建立'
  }

  if (actionType === 'delete') {
    return '工單已刪除'
  }

  if (actionType === 'assign') {
    return `已指派給 ${newRec?.assigned_to}`
  }

  if (actionType === 'comment') {
    return '已新增評論'
  }

  return actionType
}
