import type { MetadataRoute } from "next";

const BASE = (process.env.BASE_URL ?? "{{SITE_URL}}").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/cart", "/checkout/"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
