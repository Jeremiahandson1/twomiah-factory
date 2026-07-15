import type { MetadataRoute } from "next";
import { getActiveProducts } from "@/lib/catalog";

// Products come from the crm-store API at request time, so don't prerender.
export const dynamic = "force-dynamic";

const BASE = (process.env.BASE_URL ?? "{{SITE_URL}}").replace(/\/$/, "");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getActiveProducts();

  return [
    {
      url: `${BASE}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1.0,
    },
    ...products.map((p) => ({
      url: `${BASE}/products/${p.slug}`,
      lastModified: p.updatedAt ? new Date(p.updatedAt) : new Date(),
      changeFrequency: "weekly" as const,
      priority: p.featured ? 0.9 : 0.7,
    })),
  ];
}
