import { SupabaseClient } from '@supabase/supabase-js'

export interface AuditLogEntry {
  id: string
  user_id: string | null
  user_name: string | null
  action_type: string
  resource_type: string
  resource_id: string
  old_value: any
  new_value: any
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
    oldValue?: any
    newValue?: any
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
  oldValue: any,
  newValue: any,
): string {
  if (actionType === 'status_change') {
    return `狀態從 "${oldValue}" 變更為 "${newValue}"`
  }

  if (actionType === 'update') {
    const changes: string[] = []
    if (oldValue?.title !== newValue?.title) {
      changes.push(`標題: "${oldValue?.title}" → "${newValue?.title}"`)
    }
    if (oldValue?.status !== newValue?.status) {
      changes.push(`狀態: "${oldValue?.status}" → "${newValue?.status}"`)
    }
    if (oldValue?.description !== newValue?.description) {
      changes.push('描述已更新')
    }
    if (oldValue?.assigned_to !== newValue?.assigned_to) {
      changes.push(`指派: "${oldValue?.assigned_to}" → "${newValue?.assigned_to}"`)
    }
    return changes.length > 0 ? changes.join(' | ') : '已更新'
  }

  if (actionType === 'create') {
    return '案件已建立'
  }

  if (actionType === 'delete') {
    return '案件已刪除'
  }

  if (actionType === 'assign') {
    return `已指派給 ${newValue?.assigned_to}`
  }

  if (actionType === 'comment') {
    return '已新增評論'
  }

  return actionType
}
