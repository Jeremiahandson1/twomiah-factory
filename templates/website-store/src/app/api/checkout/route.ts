import { NextResponse } from "next/server";

// Thin server proxy to the crm-store PUBLIC checkout endpoint. This storefront
// never touches Stripe or a database — the crm-store backend owns pricing,
// inventory validation, and the payment session. We forward the posted cart
// (items keyed by sku) and relay the { url } the backend returns.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const base = process.env.CRM_STORE_API_URL;
  if (!base) {
    return NextResponse.json(
      { error: "Checkout is not configured" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/public/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const data = (await res.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
    };

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error ?? "Checkout failed" },
        { status: res.status },
      );
    }

    if (!data.url) {
      return NextResponse.json(
        { error: "Checkout service did not return a URL" },
        { status: 502 },
      );
    }

    return NextResponse.json({ url: data.url });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the checkout service" },
      { status: 502 },
    );
  }
}
