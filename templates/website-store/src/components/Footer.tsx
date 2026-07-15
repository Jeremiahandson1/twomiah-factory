import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border bg-muted/30 mt-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid sm:grid-cols-3 gap-8 text-sm">
        <div>
          <div className="font-bold text-lg mb-2">{"{{COMPANY_NAME}}"}</div>
          <p className="text-muted-foreground">{"{{META_DESCRIPTION}}"}</p>
        </div>
        <div>
          <div className="font-semibold mb-2">Shop</div>
          <ul className="space-y-1 text-muted-foreground">
            <li>
              <Link href="/" className="hover:text-foreground">
                All products
              </Link>
            </li>
            <li>
              <Link href="/#custom" className="hover:text-foreground">
                Custom orders
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <div className="font-semibold mb-2">Contact</div>
          <ul className="space-y-1 text-muted-foreground">
            <li>
              <a
                href="mailto:{{COMPANY_EMAIL}}"
                className="hover:text-foreground"
              >
                {"{{COMPANY_EMAIL}}"}
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-xs text-muted-foreground">
          © {new Date().getFullYear()} {"{{COMPANY_NAME}}"}. A Twomiah brand.
        </div>
      </div>
    </footer>
  );
}
