import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "{{COMPANY_NAME}} — {{HERO_TITLE}}";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function HomeOgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "space-between",
          padding: "80px",
          background:
            "linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 60%, {{PRIMARY_COLOR}} 100%)",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em" }}>
          {"{{COMPANY_NAME}}"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              fontSize: 96,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              maxWidth: 1000,
            }}
          >
            {"{{HERO_TITLE}}"}
          </div>
          <div style={{ fontSize: 28, color: "#cbd5e1", maxWidth: 900 }}>
            {"{{HERO_DESCRIPTION}}"}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
