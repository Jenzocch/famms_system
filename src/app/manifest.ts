import type { MetadataRoute } from 'next'

// Web App Manifest — lets factory-floor users "Add to Home Screen" and open
// FAMMS full-screen like a native app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FAMMS — Factory Asset & Maintenance Management',
    short_name: 'FAMMS',
    description: 'Factory incident reporting & maintenance management',
    start_url: '/incidents',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2563eb',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
