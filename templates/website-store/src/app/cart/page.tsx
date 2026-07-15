"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingBagIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { ProductImage } from "@/components/ProductImage";
import { CheckoutButton } from "@/components/CheckoutButton";
import { useCart, cartSubtotalCents } from "@/lib/cart-store";
import { formatMoney } from "@/lib/money";

export default function CartPage() {
  const items = useCart((s) => s.items);
  const updateQty = useCart((s) => s.updateQty);
  const remove = useCart((s) => s.remove);

  // Hydration guard — cart is client-only state.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold mb-8">Cart</h1>
        <div className="text-muted-foreground">Loading…</div>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center space-y-4">
          <ShoppingBagIcon className="w-12 h-12 mx-auto text-muted-foreground" />
          <h1 className="text-3xl font-bold">Your cart is empty</h1>
          <p className="text-muted-foreground">
            Nothing in here yet. Find something to add.
          </p>
          <Link
            href="/"
            className="inline-block bg-foreground text-background px-6 py-3 rounded-md font-medium hover:opacity-90"
          >
            Browse the shop
          </Link>
        </div>
      </main>
    );
  }

  const subtotal = cartSubtotalCents(items);

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold mb-8">Cart</h1>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          {items.map((item) => (
            <div
              key={item.variantId}
              className="flex gap-4 border border-border rounded-lg p-4"
            >
              <Link
                href={`/products/${item.slug}`}
                className="relative w-24 h-24 sm:w-32 sm:h-32 flex-shrink-0 rounded-md overflow-hidden bg-muted"
              >
                <ProductImage
                  src={item.imageUrl}
                  alt={item.productName}
                  productName={item.productName}
                  className="absolute inset-0 w-full h-full"
                  sizes="128px"
                />
              </Link>

              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      href={`/products/${item.slug}`}
                      className="font-medium hover:opacity-70"
                    >
                      {item.productName}
                    </Link>
                    <div className="text-sm text-muted-foreground">
                      {item.variantName}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(item.variantId)}
                    aria-label="Remove from cart"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <XMarkIcon className="w-5 h-5" />
                  </button>
                </div>

                <div className="mt-auto flex items-center justify-between gap-4 pt-3">
                  <div className="inline-flex items-center border border-border rounded-md">
                    <button
                      type="button"
                      onClick={() =>
                        updateQty(item.variantId, item.quantity - 1)
                      }
                      className="w-8 h-8 hover:bg-muted"
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sm font-medium">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateQty(item.variantId, item.quantity + 1)
                      }
                      disabled={
                        item.maxQuantity !== null &&
                        item.quantity >= item.maxQuantity
                      }
                      className="w-8 h-8 hover:bg-muted disabled:opacity-40"
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>

                  <div className="text-right">
                    <div className="font-semibold">
                      {formatMoney(item.unitPriceCents * item.quantity)}
                    </div>
                    {item.quantity > 1 && (
                      <div className="text-xs text-muted-foreground">
                        {formatMoney(item.unitPriceCents)} each
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <aside className="lg:col-span-1">
          <div className="border border-border rounded-lg p-6 space-y-4 sticky top-20">
            <h2 className="font-bold text-lg">Order summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-medium">{formatMoney(subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Shipping</span>
                <span>Calculated at checkout</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Tax</span>
                <span>Calculated at checkout</span>
              </div>
            </div>
            <div className="border-t border-border pt-4 flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>{formatMoney(subtotal)}+</span>
            </div>
            <CheckoutButton />
            <p className="text-xs text-muted-foreground text-center">
              Secure checkout. Tax and shipping calculated on the next page.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
