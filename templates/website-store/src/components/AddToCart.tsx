"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ShoppingBagIcon } from "@heroicons/react/24/outline";
import { useCart } from "@/lib/cart-store";
import { formatMoney } from "@/lib/money";
import type { ProductVariant } from "@/lib/catalog";

type Props = {
  productId: string;
  slug: string;
  productName: string;
  imageUrl: string | null;
  variants: ProductVariant[];
  isMadeToOrder: boolean;
};

function availableQty(v: ProductVariant, isMadeToOrder: boolean): number | null {
  if (isMadeToOrder) return null;
  return v.inventoryQty;
}

export function AddToCart({
  productId,
  slug,
  productName,
  imageUrl,
  variants,
  isMadeToOrder,
}: Props) {
  const router = useRouter();
  const add = useCart((s) => s.add);

  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const variant = variants.find((v) => v.id === variantId) ?? variants[0];
  if (!variant) return null;

  const maxQty = availableQty(variant, isMadeToOrder);
  const soldOut = maxQty !== null && maxQty <= 0;

  function handleAdd() {
    add(
      {
        variantId: variant.id,
        productId,
        slug,
        productName,
        variantName: variant.name,
        sku: variant.sku,
        unitPriceCents: variant.priceCents,
        imageUrl,
        maxQuantity: maxQty,
      },
      qty,
    );
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-2xl font-bold">
          {formatMoney(variant.priceCents)}
        </div>
        {variant.compareAtPriceCents &&
          variant.compareAtPriceCents > variant.priceCents && (
            <div className="text-sm text-muted-foreground line-through">
              {formatMoney(variant.compareAtPriceCents)}
            </div>
          )}
      </div>

      {variants.length > 1 && (
        <div>
          <div className="text-sm font-medium mb-2">Variant</div>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => {
              const selected = v.id === variantId;
              const vMax = availableQty(v, isMadeToOrder);
              const vSoldOut = vMax !== null && vMax <= 0;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    setVariantId(v.id);
                    setQty(1);
                  }}
                  disabled={vSoldOut}
                  className={`px-4 py-2 rounded-md border text-sm transition-colors ${
                    selected
                      ? "border-foreground bg-foreground text-background"
                      : "border-border hover:border-foreground"
                  } ${vSoldOut ? "opacity-40 cursor-not-allowed line-through" : ""}`}
                >
                  {v.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!soldOut && (
        <div>
          <div className="text-sm font-medium mb-2">Quantity</div>
          <div className="inline-flex items-center border border-border rounded-md">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="w-10 h-10 hover:bg-muted"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="w-10 text-center font-medium">{qty}</span>
            <button
              type="button"
              onClick={() =>
                setQty((q) =>
                  maxQty === null ? q + 1 : Math.min(q + 1, maxQty),
                )
              }
              disabled={maxQty !== null && qty >= maxQty}
              className="w-10 h-10 hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
          {maxQty !== null && maxQty <= 5 && (
            <p className="text-xs text-muted-foreground mt-2">
              Only {maxQty} left in stock
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={handleAdd}
          disabled={soldOut}
          className="flex-1 inline-flex items-center justify-center gap-2 bg-foreground text-background h-12 rounded-md font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {added ? (
            <>
              <CheckIcon className="w-5 h-5" /> Added
            </>
          ) : soldOut ? (
            "Sold out"
          ) : (
            <>
              <ShoppingBagIcon className="w-5 h-5" /> Add to cart
            </>
          )}
        </button>
        {!soldOut && (
          <button
            type="button"
            onClick={() => {
              handleAdd();
              router.push("/cart");
            }}
            className="flex-1 inline-flex items-center justify-center gap-2 border border-border h-12 rounded-md font-medium hover:bg-muted"
          >
            Buy now
          </button>
        )}
      </div>

      {isMadeToOrder && (
        <p className="text-xs text-muted-foreground">
          Made to order — typical lead time is noted below.
        </p>
      )}
    </div>
  );
}
