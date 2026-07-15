import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ProductImage } from "@/components/ProductImage";
import { AddToCart } from "@/components/AddToCart";
import { getProductBySlug, primaryImage } from "@/lib/catalog";
import { productJsonLd } from "@/lib/json-ld";

export const dynamic = "force-dynamic";

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return {};
  return {
    title: product.seoTitle ?? product.name,
    description:
      product.seoDescription ?? product.tagline ?? product.description ?? undefined,
    openGraph: {
      title: product.name,
      description: product.tagline ?? product.description ?? undefined,
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product || product.status !== "active") notFound();

  const img = primaryImage(product);
  const otherImages = product.images.filter((i) => i.id !== img?.id);
  const isMadeToOrder = product.productType === "made_to_order";

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: productJsonLd(product) }}
      />
      <nav className="text-sm text-muted-foreground mb-6">
        <Link href="/" className="hover:text-foreground">
          Shop
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{product.name}</span>
      </nav>

      <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
        {/* Gallery */}
        <div className="space-y-4">
          <div className="relative aspect-square rounded-lg overflow-hidden bg-muted">
            <ProductImage
              src={img?.url}
              alt={img?.alt ?? product.name}
              productName={product.name}
              className="absolute inset-0 w-full h-full"
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
          </div>
          {otherImages.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {otherImages.map((i) => (
                <div
                  key={i.id}
                  className="relative aspect-square rounded-md overflow-hidden bg-muted"
                >
                  <ProductImage
                    src={i.url}
                    alt={i.alt ?? product.name}
                    productName={product.name}
                    className="absolute inset-0 w-full h-full"
                    sizes="20vw"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              {product.name}
            </h1>
            {product.tagline && (
              <p className="mt-2 text-lg text-muted-foreground">
                {product.tagline}
              </p>
            )}
          </div>

          <AddToCart
            productId={product.id}
            slug={product.slug}
            productName={product.name}
            imageUrl={img?.url ?? null}
            variants={product.variants}
            isMadeToOrder={isMadeToOrder}
          />

          {product.description && (
            <div className="border-t border-border pt-6 prose-sm max-w-none">
              <h2 className="font-semibold mb-2">Details</h2>
              <p className="text-muted-foreground whitespace-pre-line leading-relaxed">
                {product.description}
              </p>
            </div>
          )}

          <div className="border-t border-border pt-6 space-y-2 text-sm text-muted-foreground">
            {isMadeToOrder && product.leadTimeDays && (
              <div className="flex justify-between">
                <span>Lead time</span>
                <span className="text-foreground">
                  ~{product.leadTimeDays} days
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Returns</span>
              <span className="text-foreground">
                {isMadeToOrder ? "Custom — final sale" : "30 days"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
