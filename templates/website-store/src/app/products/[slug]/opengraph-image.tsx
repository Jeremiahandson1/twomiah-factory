import { ImageResponse } from "next/og";
import { getProductBySlug, startingPriceCents } from "@/lib/catalog";
import { formatMoney } from "@/lib/money";

export const runtime = "nodejs";
export const alt = "{{COMPANY_NAME}} product";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function ProductOgImage({
  params,
}: {
  params: { slug: string };
}) {
  const product = await getProductBySlug(params.slug);
  if (!product) {
    return new ImageResponse(
      (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0a0a0a",
            color: "#fff",
            fontSize: 48,
          }}
        >
          {"{{COMPANY_NAME}}"}
        </div>
      ),
      size,
    );
  }

  const price = startingPriceCents(product);
  const hasMultiple = product.variants.length > 1;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background:
            "linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 60%, {{PRIMARY_COLOR}} 100%)",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 28,
            color: "#cbd5e1",
          }}
        >
          <span style={{ fontWeight: 700, color: "#fff" }}>
            {"{{COMPANY_NAME}}"}
          </span>
          <span>
            {hasMultiple ? "From " : ""}
            {formatMoney(price)}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              maxWidth: 1040,
            }}
          >
            {product.name}
          </div>
          {product.tagline && (
            <div style={{ fontSize: 32, color: "#cbd5e1", maxWidth: 1000 }}>
              {product.tagline}
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
