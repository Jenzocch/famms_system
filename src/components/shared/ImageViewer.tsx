'use client'

import { PhotoProvider, PhotoView } from 'react-photo-view'
import 'react-photo-view/dist/react-photo-view.css'
import Image from 'next/image'
import { Download, ZoomIn } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface Props {
  paths: string[]
  supabaseUrl: string
  bucket?: string
}

export default function ImageViewer({ paths, supabaseUrl, bucket = 'incident-photos' }: Props) {
  const { t } = useI18n()
  if (!paths || paths.length === 0) return null

  function getUrl(path: string) {
    return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`
  }

  return (
    <PhotoProvider
      toolbarRender={({ onScale, scale, images: imgs, index }) => (
        <div className="flex gap-4 text-white text-sm items-center justify-center bg-black/60 px-4 py-2 rounded-lg">
          <button
            onClick={() => onScale(scale - 0.5)}
            className="hover:opacity-70 transition-opacity text-lg font-bold"
            title={t('incidentDetail.zoomOut')}
          >
            −
          </button>
          <span className="text-xs min-w-12 text-center">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => onScale(scale + 0.5)}
            className="hover:opacity-70 transition-opacity text-lg font-bold"
            title={t('incidentDetail.zoomIn')}
          >
            +
          </button>
          <div className="w-px h-5 bg-white/30" />
          <a
            href={(imgs as { src?: string }[])[index]?.src}
            download={`photo-${index + 1}.jpg`}
            className="hover:opacity-70 transition-opacity"
            title={t('incidentDetail.download')}
          >
            <Download className="w-5 h-5" />
          </a>
          <span className="text-xs text-gray-300">
            {index + 1} / {paths.length}
          </span>
        </div>
      )}
    >
      <div className="space-y-2">
        <p className="text-xs text-gray-400">
          {t('incidentDetail.photoHint').replace('{count}', String(paths.length))}
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {paths.map((path, i) => (
            <PhotoView key={path} src={getUrl(path)}>
              <div className="group relative aspect-square rounded-lg overflow-hidden cursor-zoom-in bg-gray-100">
                <Image
                  src={getUrl(path)}
                  alt={`Photo ${i + 1}`}
                  fill
                  unoptimized
                  className="object-cover group-hover:scale-110 transition-transform duration-300"
                  sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 20vw"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <span className="absolute bottom-1 right-1 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded">
                  {i + 1}
                </span>
              </div>
            </PhotoView>
          ))}
        </div>
      </div>
    </PhotoProvider>
  )
}
