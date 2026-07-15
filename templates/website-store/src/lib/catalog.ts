// Catalog data layer. In the standalone breakerdisplays storefront these
// getters read from a local Postgres via Drizzle. In the Twomiah factory
// storefront the database lives in a separate `crm-store` backend, so every
// read here is an HTTP fetch against that backend's PUBLIC API. No DB client,
// no ORM, no secrets in the browser — all reads happen in server components.
//
// The backend base URL comes from the SERVER-only env var CRM_STORE_API_URL
// (deliberately NOT NEXT_PUBLIC).

// ----------------------------------------------------------------------------
// Types — mirror the crm-store PUBLIC API contract.
// ----------------------------------------------------------------------------

export type ProductImage = {
  id: string;
  url: string;
  alt: string | null;
  position: number;
  isPrimary: boolean;
};

export type ProductVariant = {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  weightOz: number | null;
  // null = untracked (always available). 0 = sold out.
  inventoryQty: number | null;
  options: Record<string, string> | null;
  position: number;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  status: string;
  featured: boolean;
  leadTimeDays: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  position: number;
  // Optional catalog extras the API may include. `productType` distinguishes
  // ready-to-ship vs made-to-order; when absent the storefront treats every
  // product as a normal stocked item.
  productType?: "ready_to_ship" | "made_to_order";
  updatedAt?: string;
};

export type ProductWithDetails = Product & {
  images: ProductImage[];
  variants: ProductVariant[];
};

// ----------------------------------------------------------------------------
// Pure helpers — unchanged from the standalone storefront.
// ----------------------------------------------------------------------------

function lowestPriceCents(variants: ProductVariant[]): number {
  return variants.reduce(
    (min, v) => (v.priceCents < min ? v.priceCents : min),
    Number.POSITIVE_INFINITY,
  );
}

export function startingPriceCents(p: ProductWithDetails): number {
  if (p.variants.length === 0) return 0;
  return lowestPriceCents(p.variants);
}

export function primaryImage(p: ProductWithDetails): ProductImage | null {
  if (p.images.length === 0) return null;
  return p.images.find((i) => i.isPrimary) ?? p.images[0];
}

export function isInStock(p: ProductWithDetails): boolean {
  if (p.productType === "made_to_order") return true;
  return p.variants.some(
    (v) => v.inventoryQty === null || v.inventoryQty > 0,
  );
}

// ----------------------------------------------------------------------------
// API fetch layer.
// ----------------------------------------------------------------------------

function apiBase(): string | null {
  const base = process.env.CRM_STORE_API_URL;
  if (!base) return null;
  return base.replace(/\/$/, "");
}

// Ensure a fetched product always has arrays for images/variants so the pure
// helpers and UI never crash on a partial payload.
function normalize(
  p: Partial<ProductWithDetails> | null,
): ProductWithDetails | null {
  if (!p || typeof p !== "object" || !p.id) return null;
  return {
    ...(p as ProductWithDetails),
    images: Array.isArray(p.images) ? p.images : [],
    variants: Array.isArray(p.variants) ? p.variants : [],
  };
}

export async function getActiveProducts(): Promise<ProductWithDetails[]> {
  const base = apiBase();
  if (!base) return [];
  try {
    const res = await fetch(`${base}/api/public/products`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { products?: ProductWithDetails[] };
    if (!Array.isArray(data.products)) return [];
    return data.products
      .map((p) => normalize(p))
      .filter((p): p is ProductWithDetails => p !== null);
  } catch {
    return [];
  }
}

export async function getFeaturedProducts(): Promise<ProductWithDetails[]> {
  const all = await getActiveProducts();
  const featured = all.filter((p) => p.featured);
  return featured.length > 0 ? featured : all;
}

export async function getProductBySlug(
  slug: string,
): Promise<ProductWithDetails | null> {
  const base = apiBase();
  if (!base) return null;
  try {
    const res = await fetch(
      `${base}/api/public/products/${encodeURIComponent(slug)}`,
      { cache: "no-store" },
    );
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { product?: ProductWithDetails | null };
    return normalize(data.product ?? null);
  } catch {
    return null;
  }
}
