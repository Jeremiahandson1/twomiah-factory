import { z } from 'zod'

/** Strip HTML/script tags and collapse whitespace from a short text field. */
export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim()
}

/**
 * A bounded, tag-stripped string for short display fields (names, company, city).
 * Rejects anything over `max` chars with a clean validation error and removes any
 * embedded HTML so a "<script>" name can't be stored raw.
 */
export function shortText(max = 200) {
  return z.string().max(max, `Must be ${max} characters or fewer`).transform(stripTags)
}

/** A length-capped free-text field (notes/descriptions) — tags left intact, just bounded. */
export function longText(max = 10000) {
  return z.string().max(max, `Must be ${max} characters or fewer`)
}
