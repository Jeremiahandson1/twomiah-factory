import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';

interface Category {
  id: string;
  name: string;
  icon?: string;
  product_count?: number;
}

interface CategoryGridProps {
  selectedId: string | null;
  onSelect: (category: Category) => void;
}

export default function CategoryGrid({ selectedId, onSelect }: CategoryGridProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/api/pricebook/categories');
        setCategories(res.data);
      } catch (err) {
        console.error('Failed to load categories', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-gray-200 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat)}
          className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all min-h-[80px] active:scale-95 ${
            selectedId === cat.id
              ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-md'
              : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          {cat.icon && (
            <span className="text-3xl mb-1">{cat.icon}</span>
          )}
          <span className="text-base font-semibold text-center leading-tight">{cat.name}</span>
          {cat.product_count !== undefined && (
            <span className="text-xs text-gray-400 mt-1">{cat.product_count} products</span>
          )}
        </button>
      ))}
    </div>
  );
}
