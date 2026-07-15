import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Merchant product image URLs are arbitrary (they live in crm-store /
    // whatever object storage the merchant uses), so allow any https host.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
