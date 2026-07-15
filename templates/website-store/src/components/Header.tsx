import Link from "next/link";
import { CartIcon } from "./CartIcon";

export function Header() {
  return (
    <header className="border-b border-border bg-background sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="font-bold text-xl tracking-tight">
          {"{{COMPANY_NAME}}"}
        </Link>
        <nav className="hidden sm:flex items-center gap-8 text-sm">
          <Link href="/" className="hover:opacity-70">
            Shop
          </Link>
          <Link href="/#custom" className="hover:opacity-70">
            Custom Orders
          </Link>
          <Link href="/#about" className="hover:opacity-70">
            About
          </Link>
        </nav>
        <CartIcon />
      </div>
    </header>
  );
}
