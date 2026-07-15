import Link from "next/link";
import { ProductImage } from "./ProductImage";
import { formatMoney } from "@/lib/money";
import {
  isInStock,
  primaryImage,
  startingPriceCents,
  type ProductWithDetails,
} from "@/lib/catalog";

type Props = {
  product: ProductWithDetails;
};

export function ProductCard({ product }: Props) {
  const img = primaryImage(product);
  const price = startingPriceCents(product);
  const inStock = isInStock(product);
  const hasMultipleVariants = product.variants.length > 1;
  const showFromPrefix = hasMultipleVariants;

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group block"
    >
      <div className="relative aspect-square rounded-lg overflow-hidden bg-muted">
        <ProductImage
          src={img?.url}
          alt={img?.alt ?? product.name}
          productName={product.name}
          className="absolute inset-0 w-full h-full group-hover:scale-105 transition-transform duration-300"
        />
        {!inStock && (
          <div className="absolute top-2 left-2 bg-foreground/80 text-background text-xs font-semibold px-2 py-1 rounded">
            Sold out
          </div>
        )}
        {product.productType === "made_to_order" && inStock && (
          <div className="absolute top-2 left-2 bg-background/90 backdrop-blur text-xs font-semibold px-2 py-1 rounded">
            Made to order
          </div>
        )}
      </div>
      <div className="pt-3 space-y-1">
        <h3 className="font-medium leading-snug line-clamp-2 group-hover:opacity-70">
          {product.name}
        </h3>
        {product.tagline && (
          <p className="text-sm text-muted-foreground line-clamp-1">
            {product.tagline}
          </p>
        )}
        <p className="text-sm font-semibold pt-1">
          {showFromPrefix ? "From " : ""}
          {formatMoney(price)}
        </p>
      </div>
    </Link>
  );
}
