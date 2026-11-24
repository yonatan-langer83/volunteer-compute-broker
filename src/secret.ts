import { createHash, timingSafeEqual } from 'node:crypto'

// Compare digests so the check takes the same time for a wrong token of any length.
export function secretEquals(provided: string, expected: string): boolean {
  if (expected.length === 0) return false
  const left = createHash('sha256').update(provided).digest()
  const right = createHash('sha256').update(expected).digest()
  return timingSafeEqual(left, right)
}
