import { View, Text, TouchableOpacity, useWindowDimensions } from 'react-native';

interface Category {
  id: string;
  name: string;
  icon: string | null;
  sort_order: number;
  mode: string;
}

interface CategoryGridProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (categoryId: string) => void;
}

export function CategoryGrid({ categories, selectedId, onSelect }: CategoryGridProps) {
  const { width } = useWindowDimensions();
  const isTablet = width > 768;
  const columns = isTablet ? 3 : 2;
  const gap = 12;
  const padding = 0;
  const itemWidth = (width - padding * 2 - gap * (columns - 1)) / columns - 24;

  return (
    <View className="flex-row flex-wrap" style={{ gap }}>
      {categories.map((cat) => (
        <TouchableOpacity
          key={cat.id}
          style={{ width: itemWidth, minHeight: 80 }}
          className={`rounded-xl p-4 items-center justify-center ${
            selectedId === cat.id
              ? 'bg-primary border-2 border-primary'
              : 'bg-white border border-gray-100'
          }`}
          onPress={() => onSelect(cat.id)}
          activeOpacity={0.7}
        >
          {cat.icon && (
            <Text className="text-2xl mb-1">{cat.icon}</Text>
          )}
          <Text
            className={`text-sm font-medium text-center ${
              selectedId === cat.id ? 'text-white' : 'text-gray-700'
            }`}
            numberOfLines={2}
          >
            {cat.name}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
