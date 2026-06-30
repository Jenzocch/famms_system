import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Incident/PM photos are served from Supabase Storage public URLs
    // (https://<project>.supabase.co/storage/v1/object/public/...). next/image
    // refuses to load remote hosts that aren't allowlisted, which made the
    // detail-page thumbnails appear blank.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  // Client-side router cache. By default dynamic pages have a 0s stale time, so
  // every bottom-nav switch re-hits the server (auth check + Supabase queries),
  // which makes tab switching feel slow — especially toggling back and forth.
  // Keeping visited pages for a short window makes re-visits instant; data is at
  // most this many seconds stale, which is fine for this app (a refresh/navigation
  // still revalidates).
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
