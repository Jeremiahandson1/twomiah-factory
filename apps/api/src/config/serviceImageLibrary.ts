/**
 * Curated fallback "fill library" for service-card images.
 *
 * The AI composer (contentGenerator.generateWebsiteContent) leaves
 * GeneratedService.image empty, and Unsplash+ search (searchStockPhotosForBusiness)
 * returns nothing unless an Unsplash key is configured. This library is the
 * no-API fallback so service cards are never blank: keyed by industry token,
 * with GENERIC as the catch-all.
 *
 * IMPORTANT — this is a STARTER. The shipped per-template build/images/services/*
 * are all contractor/roofing photos (cloned, never re-shot), so they're wrong for
 * non-contractor verticals. Expand the arrays below with on-brand stock per
 * vertical (or configure an Unsplash key to auto-source). URLs are Unsplash direct
 * CDN (no API key needed) sized for cards.
 */
const SZ = '?auto=format&fit=crop&w=900&q=70'

export const SERVICE_IMAGE_LIBRARY: Record<string, string[]> = {
  // rv / powersports / marine — verified marine hero used on the Zacho demo.
  rv: [
    'https://images.unsplash.com/photo-1605281317010-fe5ffe798166' + SZ,
    'https://images.unsplash.com/photo-1568438350562-2cae6d394ad0' + SZ,
    'https://images.unsplash.com/photo-1558981403-c5f9899a28bc' + SZ,
  ],
  // GENERIC professional-service fallback (used for any unmapped industry).
  GENERIC: [
    'https://images.unsplash.com/photo-1521791136064-7986c2920216' + SZ,
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab' + SZ,
    'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40' + SZ,
  ],
  // TODO: populate per vertical with verified on-brand photos.
  general_contractor: [], roofing: [], field_service: [], hvac: [],
  home_care: [], landscaping: [], dispensary: [], veterinary: [], food: [],
}

/** Returns a fallback image URL for a service by industry + index, or '' if none. */
export function getServiceImage(industry: string, i: number): string {
  const key = (industry || '').toLowerCase().replace(/\s+/g, '_')
  const set = (SERVICE_IMAGE_LIBRARY[key]?.length ? SERVICE_IMAGE_LIBRARY[key] : SERVICE_IMAGE_LIBRARY.GENERIC) || []
  return set.length ? set[i % set.length] : ''
}
