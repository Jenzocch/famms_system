'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Department, formatRupiah, getApprovalTier } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import ImageUploader from './ImageUploader'
import AttachmentUploader from './AttachmentUploader'
import UrlInput from './UrlInput'
import VendorForm from './VendorForm'
import { toast } from 'sonner'
import { Loader2, Send, Save, Info } from 'lucide-react'
import { APPROVAL_THRESHOLDS } from '@/lib/constants'
import PriceIntelligence from './PriceIntelligence'

interface RequestFormProps {
  departments: Department[]
  userId: string
}

export default function RequestForm({ departments, userId }: RequestFormProps) {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [title, setTitle] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [purpose, setPurpose] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [estimatedCost, setEstimatedCost] = useState('')
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const [uploadedAttachments, setUploadedAttachments] = useState<{ path: string; name: string; type: string; size: number }[]>([])
  const [urls, setUrls] = useState<{ url: string; title?: string; description?: string; thumbnail?: string }[]>([])
  const [vendors, setVendors] = useState<{ vendor_name: string; price: string; delivery_days: string; payment_terms: string; warranty: string; remarks: string }[]>([])

  const costNum = parseFloat(estimatedCost.replace(/[^0-9.]/g, '')) || 0

  async function saveRequest(asSubmit = false) {
    if (!title.trim() || !departmentId || !purpose.trim() || !estimatedCost) {
      toast.error('Please fill in all required fields')
      return null
    }

    const fn = asSubmit ? setSubmitting : setSaving
    fn(true)

    try {
      const { data: req, error } = await supabase
        .from('purchase_requests')
        .insert({
          title: title.trim(),
          department_id: departmentId,
          applicant_id: userId,
          purpose: purpose.trim(),
          quantity,
          estimated_cost: costNum,
          status: asSubmit ? 'pending_dept_manager' : 'draft',
          current_approver_role: asSubmit ? 'dept_manager' : null,
          submitted_at: asSubmit ? new Date().toISOString() : null,
        })
        .select()
        .single()

      if (error) throw error
      const requestId = req.id

      if (uploadedImages.length > 0) {
        await supabase.from('request_images').insert(
          uploadedImages.map((path, i) => ({ request_id: requestId, storage_path: path, sort_order: i }))
        )
      }

      if (uploadedAttachments.length > 0) {
        await supabase.from('request_attachments').insert(
          uploadedAttachments.map(a => ({
            request_id: requestId,
            storage_path: a.path,
            file_name: a.name,
            file_type: a.type,
            file_size: a.size,
          }))
        )
      }

      if (urls.length > 0) {
        await supabase.from('request_urls').insert(
          urls.map((u, i) => ({ request_id: requestId, ...u, sort_order: i }))
        )
      }

      const validVendors = vendors.filter(v => v.vendor_name.trim())
      if (validVendors.length > 0) {
        await supabase.from('vendors').insert(
          validVendors.map((v, i) => ({
            request_id: requestId,
            vendor_name: v.vendor_name,
            price: parseFloat(v.price) || null,
            delivery_days: parseInt(v.delivery_days) || null,
            payment_terms: v.payment_terms || null,
            warranty: v.warranty || null,
            remarks: v.remarks || null,
            sort_order: i,
          }))
        )
      }

      toast.success(asSubmit ? 'Request submitted for approval!' : 'Draft saved')
      router.push(asSubmit ? `/requests/${requestId}` : '/dashboard')
      return requestId
    } catch (err: any) {
      toast.error(err.message || 'Failed to save request')
      return null
    } finally {
      fn(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Basic Information</h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="title">Purchase Title <span className="text-red-500">*</span></Label>
            <Input id="title" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. CMC / Xantham Gum / Dextrose" className="mt-1" />
            <PriceIntelligence searchTerm={title} currentPrice={costNum || undefined} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Department <span className="text-red-500">*</span></Label>
              <Select value={departmentId} onValueChange={(v) => setDepartmentId(v ?? '')}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="qty">Quantity <span className="text-red-500">*</span></Label>
              <Input id="qty" type="number" min={1} value={quantity}
                onChange={e => setQuantity(parseInt(e.target.value) || 1)} className="mt-1" />
            </div>
          </div>

          <div>
            <Label htmlFor="cost">Estimated Cost (IDR) <span className="text-red-500">*</span></Label>
            <Input id="cost" type="number" min={0} value={estimatedCost}
              onChange={e => setEstimatedCost(e.target.value)}
              placeholder="e.g. 15000000" className="mt-1" />
            {costNum > 0 && (
              <div className="mt-1.5 flex items-start gap-2 text-xs text-gray-500">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  {formatRupiah(costNum)} — Approval: <strong>{getApprovalTier(costNum)}</strong>
                </span>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="purpose">Business Purpose <span className="text-red-500">*</span></Label>
            <Textarea id="purpose" value={purpose} onChange={e => setPurpose(e.target.value)}
              placeholder="Explain why this purchase is needed and how it will benefit the business..."
              rows={4} className="mt-1" />
          </div>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Product Images</h2>
        <p className="text-xs text-gray-400 mb-4">Up to 20 images. Shown as thumbnails to approvers.</p>
        <ImageUploader onUpload={setUploadedImages} />
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Attachments</h2>
        <p className="text-xs text-gray-400 mb-4">PDF, Excel, Word, or images</p>
        <AttachmentUploader onUpload={setUploadedAttachments} />
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Product URLs</h2>
        <p className="text-xs text-gray-400 mb-4">Tokopedia, Shopee, or supplier website links</p>
        <UrlInput value={urls} onChange={setUrls} />
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Vendor Comparison</h2>
        <p className="text-xs text-gray-400 mb-4">Add up to 5 vendors for comparison</p>
        <VendorForm value={vendors} onChange={setVendors} />
      </section>

      <div className="flex gap-3 pb-8">
        <Button variant="outline" onClick={() => saveRequest(false)} disabled={saving || submitting}>
          {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          <Save className="w-4 h-4 mr-2" /> Save Draft
        </Button>
        <Button onClick={() => saveRequest(true)} disabled={saving || submitting} className="flex-1">
          {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          <Send className="w-4 h-4 mr-2" /> Submit for Approval
        </Button>
      </div>
    </div>
  )
}
