"use client";

import { useEffect } from "react";
import { useCart } from "@/lib/cart-store";

// Used on /checkout/success to wipe the cart after a successful return from
// Stripe. Safe to run unconditionally — the cart already paid for is no
// longer relevant to this browser.
export function ClearCartOnMount() {
  const clear = useCart((s) => s.clear);
  useEffect(() => {
    clear();
  }, [clear]);
  return null;
}
