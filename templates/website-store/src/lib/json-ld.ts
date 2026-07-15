// Schema.org JSON-LD builders. Stringify and inject as
// <script type="application/ld+json"> in pages so Google can render rich
// results (price, availability, rating in search).

import type { ProductWithDetails } from "./catalog";
import { isInStock, primaryImage } from "./catalog";

const BASE = (process.env.BASE_URL ?? "{{SITE_URL}}").replace(/\/$/, "");

export function organizationJsonLd(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "{{COMPANY_NAME}}",
    url: BASE,
    logo: `${BASE}/opengraph-image`,
    description: "{{META_DESCRIPTION}}",
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer service",
      email: "{{COMPANY_EMAIL}}",
      areaServed: "US",
    },
  });
}

export function productJsonLd(product: ProductWithDetails): string {
  const img = primaryImage(product);
  const image = img?.url ?? `${BASE}/products/${product.slug}/opengraph-image`;
  const inStock = isInStock(product);

  const offers =
    product.variants.length > 1
      ? {
          "@type": "AggregateOffer",
          priceCurrency: "USD",
          lowPrice: (
            Math.min(...product.variants.map((v) => v.priceCents)) / 100
          ).toFixed(2),
          highPrice: (
            Math.max(...product.variants.map((v) => v.priceCents)) / 100
          ).toFixed(2),
          offerCount: product.variants.length,
          availability: inStock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          url: `${BASE}/products/${product.slug}`,
        }
      : {
          "@type": "Offer",
          priceCurrency: "USD",
          price: ((product.variants[0]?.priceCents ?? 0) / 100).toFixed(2),
          availability: inStock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          url: `${BASE}/products/${product.slug}`,
          itemCondition: "https://schema.org/NewCondition",
          sku: product.variants[0]?.sku,
        };

  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description:
      product.description ??
      product.tagline ??
      `${product.name} from {{COMPANY_NAME}}`,
    image: [image],
    brand: { "@type": "Brand", name: "{{COMPANY_NAME}}" },
    sku: product.variants[0]?.sku,
    offers,
  });
}
