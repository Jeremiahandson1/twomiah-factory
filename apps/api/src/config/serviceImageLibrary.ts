/**
 * Curated fallback "fill library" for service-card + hero images.
 *
 * The AI composer (contentGenerator.generateWebsiteContent) leaves image fields
 * empty, and Unsplash+ search only returns photos when UNSPLASH_PLUS_ACCESS_KEY is
 * configured. This library is the no-API baseline so cards and heroes are NEVER
 * blank — real, on-brand stock per vertical, verified by eye. Unsplash+ (when
 * configured) layers fresher business-specific photos on top; this is the floor.
 *
 * URLs are Unsplash direct CDN (no API key needed, free to hotlink), sized for cards.
 */
const SZ = '?auto=format&fit=crop&w=1200&q=70'
const u = (id: string) => 'https://images.unsplash.com/photo-' + id + SZ

export const SERVICE_IMAGE_LIBRARY: Record<string, string[]> = {
  roofing: [
    u('1635424824849-1b09bdcc55b1'), u('1643225523483-e2c434191bba'),
    u('1633759593085-1eaeb724fc88'), u('1632759145351-1d592919f522'),
  ],
  contractor: [
    u('1587582423116-ec07293f0395'), u('1505798577917-a65157d3320a'), u('1516880711640-ef7db81be3e1'),
  ],
  fieldservice: [
    u('1621905251189-08b45d6a269e'), u('1660330589693-99889d60181e'), u('1615774925655-a0e97fc85c14'),
  ],
  homecare: [
    u('1543333995-a78aea2eee50'), u('1762955911431-4c44c7c3f408'), u('1589061434060-a05a5335bfbb'),
  ],
  landscaping: [
    u('1458245201577-fc8a130b8829'), u('1558904541-efa843a96f01'), u('1605117882932-f9e32b03fea9'),
  ],
  dispensary: [
    u('1457573557536-6b4b6ca9a05e'), u('1622704776938-bed6cd156e04'), u('1648824572347-6edd9a108e28'),
  ],
  veterinary: [
    u('1654895716780-b4664497420d'), u('1630438994394-3deff7a591bf'),
  ],
  foodtruck: [
    u('1565123409695-7b5ef63a2efb'), u('1570441262582-a2d4b9a916a5'), u('1509315811345-672d83ef2fbc'),
  ],
  rv: [
    u('1605281317010-fe5ffe798166'), u('1568438350562-2cae6d394ad0'), u('1558981403-c5f9899a28bc'),
  ],
  // GENERIC professional-service fallback (used for any unmapped industry).
  GENERIC: [
    u('1521791136064-7986c2920216'), u('1486406146926-c627a92ad1ab'), u('1454165804606-c3d57bc86b40'),
  ],
}

// Map any intake industry value → a canonical library key above. Keeps the
// dropdown's many trade values pointed at the right photo set instead of GENERIC.
const INDUSTRY_ALIAS: Record<string, string> = {
  general_contractor: 'contractor', remodeler: 'contractor', painter: 'contractor',
  concrete: 'contractor', flooring: 'contractor', construction: 'contractor', builder: 'contractor',
  hvac: 'fieldservice', plumbing: 'fieldservice', plumber: 'fieldservice',
  electrical: 'fieldservice', electrician: 'fieldservice', field_service: 'fieldservice', appliance_repair: 'fieldservice',
  home_care: 'homecare', healthcare: 'homecare', senior_care: 'homecare',
  lawn_care: 'landscaping', lawncare: 'landscaping', landscape_design: 'landscaping', snow_removal: 'landscaping',
  cannabis: 'dispensary', cannabis_retail: 'dispensary',
  vet: 'veterinary', veterinarian: 'veterinary', vet_clinic: 'veterinary', animal_hospital: 'veterinary',
  food: 'foodtruck', food_truck: 'foodtruck', restaurant: 'foodtruck', cafe: 'foodtruck',
  rv_dealer: 'rv', powersports: 'rv', marine: 'rv',
}

/** Returns a fallback image URL for a service/hero by industry + index, or '' if none. */
export function getServiceImage(industry: string, i: number): string {
  const raw = (industry || '').toLowerCase().replace(/[\s-]+/g, '_')
  const key = SERVICE_IMAGE_LIBRARY[raw] ? raw : (INDUSTRY_ALIAS[raw] || raw)
  const set = (SERVICE_IMAGE_LIBRARY[key]?.length ? SERVICE_IMAGE_LIBRARY[key] : SERVICE_IMAGE_LIBRARY.GENERIC) || []
  return set.length ? set[i % set.length] : ''
}
