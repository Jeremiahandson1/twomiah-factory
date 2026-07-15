import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { getActiveProducts, getFeaturedProducts } from "@/lib/catalog";

// No build-time data fetch — pull fresh on every request. With ~12 products
// this is trivial and we don't need to bother with revalidation tags yet.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [all, featured] = await Promise.all([
    getActiveProducts(),
    getFeaturedProducts(),
  ]);

  return (
    <main>
      {/* Hero */}
      <section className="bg-muted/40 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 text-center">
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight">
            {"{{HERO_TITLE}}"}
          </h1>
          <p className="mt-4 max-w-2xl mx-auto text-lg text-muted-foreground">
            {"{{HERO_DESCRIPTION}}"}
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              href="#shop"
              className="bg-foreground text-background px-6 py-3 rounded-md font-medium hover:opacity-90"
            >
              Shop now
            </Link>
            <Link
              href="#custom"
              className="px-6 py-3 rounded-md font-medium border border-border hover:bg-muted"
            >
              Custom orders
            </Link>
          </div>
        </div>
      </section>

      {/* Featured */}
      {featured.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h2 className="text-2xl font-bold mb-6">Featured</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {featured.slice(0, 4).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {/* Full catalog */}
      <section
        id="shop"
        className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 scroll-mt-16"
      >
        <h2 className="text-2xl font-bold mb-6">All products</h2>
        {all.length === 0 ? (
          <p className="text-muted-foreground">
            No products yet — check back soon.
          </p>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
            {all.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      {/* Custom orders strip */}
      <section
        id="custom"
        className="bg-muted/40 border-t border-border scroll-mt-16"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 grid sm:grid-cols-2 gap-8 items-center">
          <div>
            <h2 className="text-3xl font-bold">Need something custom?</h2>
            <p className="mt-3 text-muted-foreground">
              Tell us what you&apos;re after and we&apos;ll get back to you with
              a quote. Email us with the details and quantity.
            </p>
          </div>
          <div>
            <a
              href="mailto:{{COMPANY_EMAIL}}?subject=Custom%20order"
              className="inline-block bg-foreground text-background px-6 py-3 rounded-md font-medium hover:opacity-90"
            >
              Request a custom quote
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
