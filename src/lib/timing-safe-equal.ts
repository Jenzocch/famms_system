import { timingSafeEqual } from 'crypto'

// Constant-time string comparison for secrets (webhook/API bearer tokens).
// Plain `!==` leaks a timing side-channel proportional to how many leading
// bytes match — hard to exploit over real network jitter, but a shared
// secret comparison should never rely on "hard to exploit" as the defense.
// timingSafeEqual itself throws on mismatched lengths, so pad both sides to
// the longer one first — an attacker must not be able to distinguish
// "wrong length" from "wrong content" any faster than "right length, wrong
// content".
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  const len = Math.max(bufA.length, bufB.length, 1)
  const paddedA = Buffer.alloc(len)
  const paddedB = Buffer.alloc(len)
  bufA.copy(paddedA)
  bufB.copy(paddedB)
  return bufA.length === bufB.length && timingSafeEqual(paddedA, paddedB)
}
