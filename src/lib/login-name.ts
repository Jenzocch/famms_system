// Login-by-name support.
//
// Supabase Auth always authenticates with an email, but admins assign a plain
// login *name* (e.g. "teknisi1") instead of an email. We map a name to a stable
// synthetic email under SYNTHETIC_EMAIL_DOMAIN. The same helper runs on the
// login page (name -> email -> signInWithPassword) and on the admin create/edit
// routes (name -> email for the auth user), so the two never drift.
//
// Backward compatible: anything already containing "@" is treated as a real
// email and passed through unchanged, so accounts created with real emails
// keep working.

export const SYNTHETIC_EMAIL_DOMAIN = 'famms.local'

// Normalize a login name into an email local-part: lowercase, drop spaces,
// keep only characters valid in an email local-part.
function slugifyName(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9._-]/g, '')
}

// Convert a typed login identifier into the email Supabase Auth expects.
export function accountNameToEmail(input: string): string {
  const v = input.trim()
  if (v.includes('@')) return v.toLowerCase()
  return `${slugifyName(v)}@${SYNTHETIC_EMAIL_DOMAIN}`
}

// A login name is usable if it's already an email, or it slugifies to a
// non-empty local-part (pure non-ASCII names like "技師" slugify to "").
export function isValidLoginName(input: string): boolean {
  const v = input.trim()
  if (v.includes('@')) return true
  return slugifyName(v).length > 0
}
