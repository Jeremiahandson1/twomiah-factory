import { View, Text, TouchableOpacity, Image } from 'react-native';

interface Product {
  id: string;
  name: string;
  description: string | null;
  measurement_type: string | null;
  measurement_unit: string | null;
  image_url: string | null;
}

interface ProductCardProps {
  product: Product;
  onPress: () => void;
  selected?: boolean;
}

export function ProductCard({ product, onPress, selected }: ProductCardProps) {
  return (
    <TouchableOpacity
      className={`bg-white rounded-xl p-4 mb-3 flex-row items-center border ${
        selected ? 'border-primary border-2' : 'border-gray-100'
      }`}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {product.image_url ? (
        <Image
          source={{ uri: product.image_url }}
          className="w-14 h-14 rounded-lg mr-4"
          resizeMode="cover"
        />
      ) : (
        <View className="w-14 h-14 bg-gray-100 rounded-lg mr-4 items-center justify-center">
          <Text className="text-gray-400 text-2xl">&#9632;</Text>
        </View>
      )}

      <View className="flex-1">
        <Text className="text-base font-semibold text-gray-900">{product.name}</Text>
        {product.description && (
          <Text className="text-sm text-gray-500 mt-0.5" numberOfLines={1}>
            {product.description}
          </Text>
        )}
        {product.measurement_type && (
          <View className="flex-row mt-1.5">
            <View className="bg-gray-100 px-2 py-0.5 rounded">
              <Text className="text-xs text-gray-600">
                {product.measurement_type}
                {product.measurement_unit ? ` (${product.measurement_unit})` : ''}
              </Text>
            </View>
          </View>
        )}
      </View>

      <View className="ml-2">
        <Text className="text-primary text-xl">&rsaquo;</Text>
      </View>
    </TouchableOpacity>
  );
}
