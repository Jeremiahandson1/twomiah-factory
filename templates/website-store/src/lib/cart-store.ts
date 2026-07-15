"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = {
  variantId: string;
  productId: string;
  slug: string;
  productName: string;
  variantName: string;
  sku: string;
  unitPriceCents: number;
  imageUrl: string | null;
  quantity: number;
  // null = untracked / made-to-order, allow any qty
  maxQuantity: number | null;
};

type CartState = {
  items: CartItem[];
  add: (item: Omit<CartItem, "quantity">, qty?: number) => void;
  updateQty: (variantId: string, qty: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
};

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      add: (item, qty = 1) =>
        set((state) => {
          const existing = state.items.find(
            (i) => i.variantId === item.variantId,
          );
          if (existing) {
            const nextQty = existing.quantity + qty;
            const capped =
              existing.maxQuantity !== null
                ? Math.min(nextQty, existing.maxQuantity)
                : nextQty;
            return {
              items: state.items.map((i) =>
                i.variantId === item.variantId
                  ? { ...i, quantity: capped }
                  : i,
              ),
            };
          }
          const startQty =
            item.maxQuantity !== null
              ? Math.min(qty, item.maxQuantity)
              : qty;
          return {
            items: [...state.items, { ...item, quantity: startQty }],
          };
        }),
      updateQty: (variantId, qty) =>
        set((state) => ({
          items: state.items
            .map((i) => {
              if (i.variantId !== variantId) return i;
              const capped =
                i.maxQuantity !== null
                  ? Math.min(qty, i.maxQuantity)
                  : qty;
              return { ...i, quantity: Math.max(0, capped) };
            })
            .filter((i) => i.quantity > 0),
        })),
      remove: (variantId) =>
        set((state) => ({
          items: state.items.filter((i) => i.variantId !== variantId),
        })),
      clear: () => set({ items: [] }),
    }),
    { name: "{{CART_STORAGE_KEY}}" },
  ),
);

export function cartCount(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

export function cartSubtotalCents(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
}
