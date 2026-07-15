import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { organizationJsonLd } from "@/lib/json-ld";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

const SITE_URL = process.env.BASE_URL ?? "{{SITE_URL}}";

// Tolerate a missing/placeholder BASE_URL at build time — metadataBase only
// needs to be a valid URL for absolute link resolution.
function metadataBaseUrl(): URL {
  try {
    return new URL(SITE_URL);
  } catch {
    return new URL("http://localhost:3000");
  }
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "{{COMPANY_NAME}} — {{HERO_TITLE}}",
    template: "%s | {{COMPANY_NAME}}",
  },
  description: "{{META_DESCRIPTION}}",
  metadataBase: metadataBaseUrl(),
  openGraph: {
    type: "website",
    siteName: "{{COMPANY_NAME}}",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen`}
      >
        <Header />
        <div className="flex-1">{children}</div>
        <Footer />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: organizationJsonLd() }}
        />
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_ID}', { anonymize_ip: true });
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
