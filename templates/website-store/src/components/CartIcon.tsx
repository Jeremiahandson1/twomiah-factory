"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShoppingBagIcon } from "@heroicons/react/24/outline";
import { useCart, cartCount } from "@/lib/cart-store";

export function CartIcon() {
  const items = useCart((s) => s.items);
  const [mounted, setMounted] = useState(false);

  // Avoid SSR / hydration flash — count is only known on the client.
  useEffect(() => setMounted(true), []);

  const count = mounted ? cartCount(items) : 0;

  return (
    <Link
      href="/cart"
      aria-label={`Cart (${count} items)`}
      className="relative inline-flex items-center justify-center p-2 hover:opacity-70 transition-opacity"
    >
      <ShoppingBagIcon className="w-6 h-6" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 bg-accent text-accent-foreground text-xs font-semibold min-w-[1.25rem] h-5 px-1 rounded-full inline-flex items-center justify-center">
          {count}
        </span>
      )}
    </Link>
  );
}
