import React from 'react';

interface Product {
  id: string;
  name: string;
  image_url?: string;
  measurement_type: string;
  measurement_unit: string;
}

interface ProductGridProps {
  products: Product[];
  loading?: boolean;
  onSelect: (product: Product) => void;
}

const UNIT_BADGES: Record<string, string> = {
  united_inches: 'UI',
  sq_ft: 'Sq Ft',
  linear_ft: 'Lin Ft',
  each: 'Each',
};

export default function ProductGrid({ products, loading, onSelect }: ProductGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-36 bg-gray-200 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 text-lg">
        No products in this category
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {products.map((product) => (
        <button
          key={product.id}
          onClick={() => onSelect(product)}
          className="flex flex-col bg-white rounded-xl border-2 border-gray-200 overflow-hidden hover:border-blue-400 active:scale-95 transition-all min-h-[120px]"
        >
          {product.image_url ? (
            <div className="w-full h-20 bg-gray-100">
              <img
                src={product.image_url}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-full h-20 bg-gray-100 flex items-center justify-center">
              <span className="text-3xl text-gray-300">&#9632;</span>
            </div>
          )}
          <div className="p-3 flex-1 flex flex-col justify-between">
            <p className="text-sm font-semibold text-gray-800 leading-tight">{product.name}</p>
            <span className="mt-1 inline-block self-start px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded">
              {UNIT_BADGES[product.measurement_type] || product.measurement_unit}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
