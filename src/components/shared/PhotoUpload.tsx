'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { MAX_PHOTOS_PER_STAGE, MAX_FILE_SIZE_MB, ACCEPTED_IMAGE_TYPES } from '@/lib/constants'

interface Props {
  label: string
  value: string[]            // storage paths
  onChange: (paths: string[]) => void
  bucket?: string
  folder?: string            // path prefix inside the bucket
}

export default function PhotoUpload({
  label,
  value,
  onChange,
  bucket = 'incident-photos',
  folder = 'actions',
}: Props) {
  const supabase = createClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  function publicUrl(path: string) {
    return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    if (value.length + files.length > MAX_PHOTOS_PER_STAGE) {
      toast.error(`Maksimal ${MAX_PHOTOS_PER_STAGE} foto`)
      return
    }

    setUploading(true)
    const newPaths: string[] = []
    try {
      for (const file of Array.from(files)) {
        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
          toast.error(`${file.name}: format tidak didukung`)
          continue
        }
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          toast.error(`${file.name}: melebihi ${MAX_FILE_SIZE_MB}MB`)
          continue
        }
        const ext = file.name.split('.').pop()
        const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error } = await supabase.storage.from(bucket).upload(path, file, {
          cacheControl: '3600',
          upsert: false,
        })
        if (error) {
          toast.error(`Gagal upload ${file.name}: ${error.message}`)
          continue
        }
        newPaths.push(path)
      }
      if (newPaths.length) {
        onChange([...value, ...newPaths])
        toast.success(`${newPaths.length} foto terupload`)
      }
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove(path: string) {
    await supabase.storage.from(bucket).remove([path])
    onChange(value.filter(p => p !== path))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <span className="text-xs text-gray-400">{value.length}/{MAX_PHOTOS_PER_STAGE}</span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {value.map(path => (
          <div key={path} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={publicUrl(path)} alt="foto" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => remove(path)}
              className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {value.length < MAX_PHOTOS_PER_STAGE && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="aspect-square rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition"
          >
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
            <span className="text-xs mt-1">Upload</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
    </div>
  )
}
