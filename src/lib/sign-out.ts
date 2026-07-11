import { createClient } from '@/lib/supabase/client'

// Shared devices on the factory floor mean one technician's session can end
// with another technician picking up the same browser next. The service
// worker caches navigation responses (full authenticated HTML) keyed by URL,
// so without this, signing out leaves the previous user's pages readable
// offline to whoever logs in next on that device.
export async function signOutAndClearCaches() {
  const supabase = createClient()
  await supabase.auth.signOut()
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
  }
}
