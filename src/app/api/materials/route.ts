import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const search = req.nextUrl.searchParams.get('q') || ''

  let query = supabase
    .from('material_price_history')
    .select('code_bb, item_name, supplier, purchase_date, price_incl_ppn, price_excl_ppn, qty, company')
    .order('purchase_date', { ascending: true })

  if (search) {
    query = query.or(`code_bb.ilike.%${search}%,item_name.ilike.%${search}%,supplier.ilike.%${search}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by code_bb and get price history
  const grouped: Record<string, any> = {}
  for (const row of data || []) {
    if (!grouped[row.code_bb]) {
      grouped[row.code_bb] = {
        code_bb: row.code_bb,
        item_name: row.item_name,
        supplier: row.supplier,
        history: [],
      }
    }
    if (row.purchase_date && (row.price_incl_ppn || row.price_excl_ppn)) {
      grouped[row.code_bb].history.push({
        date: row.purchase_date,
        price: row.price_incl_ppn || row.price_excl_ppn,
        qty: row.qty,
        company: row.company,
      })
    }
  }

  const materials = Object.values(grouped).map((m: any) => {
    const sorted = m.history.sort((a: any, b: any) => a.date.localeCompare(b.date))
    const latest = sorted[sorted.length - 1]
    const prev = sorted[sorted.length - 2]
    const trend = latest && prev
      ? ((latest.price - prev.price) / prev.price) * 100
      : 0
    return { ...m, latest_price: latest?.price, latest_date: latest?.date, trend_pct: trend, history: sorted }
  }).sort((a: any, b: any) => a.code_bb.localeCompare(b.code_bb))

  return NextResponse.json(materials)
}
