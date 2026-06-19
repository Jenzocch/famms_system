import Link from 'next/link'
import Image from 'next/image'
import { PurchaseRequest, formatRupiah } from '@/types'
import StatusBadge from '@/components/shared/StatusBadge'
import { Calendar, Building2, ImageIcon } from 'lucide-react'
import { format } from 'date-fns'

interface RequestCardProps {
  request: PurchaseRequest
  supabaseUrl: string
}

export default function RequestCard({ request, supabaseUrl }: RequestCardProps) {
  const firstImage = request.images?.[0]
  const imageUrl = firstImage
    ? `${supabaseUrl}/storage/v1/object/public/request-images/${firstImage.storage_path}`
    : null

  return (
    <Link href={`/requests/${request.id}`}>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow active:scale-[0.99]">
        <div className="aspect-[16/9] bg-gray-100 relative overflow-hidden">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={request.title}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <ImageIcon className="w-10 h-10 text-gray-300" />
            </div>
          )}
          <div className="absolute top-2 right-2">
            <StatusBadge status={request.status} />
          </div>
        </div>

        <div className="p-4">
          <h3 className="font-bold text-gray-900 line-clamp-2 text-base leading-snug">
            {request.title}
          </h3>

          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-1 text-sm text-gray-600">
              <Building2 className="w-4 h-4" />
              <span>{request.department?.name ?? '—'}</span>
            </div>
            <span className="text-base font-bold text-blue-700">
              {formatRupiah(request.estimated_cost)}
            </span>
          </div>

          <div className="mt-2 flex items-center gap-1 text-sm text-gray-500">
            <Calendar className="w-4 h-4" />
            <span>
              {request.submitted_at
                ? format(new Date(request.submitted_at), 'dd MMM yyyy')
                : format(new Date(request.created_at), 'dd MMM yyyy')}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}
