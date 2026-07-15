"use client";

import { useState } from "react";
import { useCart } from "@/lib/cart-store";

export function CheckoutButton() {
  const items = useCart((s) => s.items);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // The crm-store checkout API is sku-based.
          items: items.map((i) => ({
            sku: i.sku,
            quantity: i.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Checkout failed");
      }
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleCheckout}
        disabled={loading || items.length === 0}
        className="w-full bg-foreground text-background h-12 rounded-md font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "Redirecting…" : "Proceed to checkout"}
      </button>
      {error && (
        <p className="text-sm text-red-600 text-center" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
