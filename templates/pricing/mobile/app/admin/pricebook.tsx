import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePricebook } from '@/hooks/usePricebook';

export default function PricebookScreen() {
  const {
    categories,
    getProductsByCategory,
    getTiersByProduct,
    getPriceRangesForProduct,
    getAddonsForProduct,
    loading,
  } = usePricebook();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['bottom']}>
      <ScrollView className="flex-1 px-6">
        <View className="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-4 mb-6">
          <Text className="text-amber-800 text-sm font-medium">
            Read-only view. To edit pricing, use the web app.
          </Text>
        </View>

        <Text className="text-lg font-semibold text-gray-900 mb-3">Categories</Text>
        <View className="flex-row flex-wrap gap-2 mb-6">
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              className={`px-4 py-3 rounded-xl ${
                selectedCategory === cat.id ? 'bg-primary' : 'bg-white border border-gray-100'
              }`}
              onPress={() => {
                setSelectedCategory(cat.id);
                setSelectedProduct(null);
              }}
            >
              <Text
                className={`text-sm font-medium ${
                  selectedCategory === cat.id ? 'text-white' : 'text-gray-700'
                }`}
              >
                {cat.icon ? `${cat.icon} ` : ''}{cat.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {selectedCategory && (
          <>
            <Text className="text-lg font-semibold text-gray-900 mb-3">Products</Text>
            {getProductsByCategory(selectedCategory).map((product) => (
              <TouchableOpacity
                key={product.id}
                className={`bg-white rounded-xl p-4 mb-2 border ${
                  selectedProduct === product.id ? 'border-primary' : 'border-gray-100'
                }`}
                onPress={() => setSelectedProduct(product.id)}
              >
                <Text className="text-base font-medium text-gray-900">{product.name}</Text>
                <Text className="text-sm text-gray-500 mt-1">
                  {product.measurement_type} ({product.measurement_unit || 'unit'})
                  {product.pitch_adjustable ? ' | Pitch adjustable' : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {selectedProduct && (
          <>
            <Text className="text-lg font-semibold text-gray-900 mb-3 mt-6">
              Tiers
            </Text>
            {getTiersByProduct(selectedProduct).map((tier) => (
              <View key={tier.id} className="bg-white rounded-xl p-4 mb-2 border border-gray-100">
                <Text className="text-base font-semibold text-gray-900 capitalize">
                  {tier.tier}
                </Text>
                {tier.material_name && (
                  <Text className="text-sm text-gray-500">Material: {tier.material_name}</Text>
                )}
                {tier.base_price != null && (
                  <Text className="text-sm text-gray-500">
                    Base: ${tier.base_price.toFixed(2)}
                  </Text>
                )}
                {tier.warranty_years != null && (
                  <Text className="text-sm text-gray-500">
                    Warranty: {tier.warranty_years} years
                  </Text>
                )}
                {tier.features && (
                  <Text className="text-sm text-gray-400 mt-1">{tier.features}</Text>
                )}
              </View>
            ))}

            <Text className="text-lg font-semibold text-gray-900 mb-3 mt-6">
              Price Ranges
            </Text>
            {getPriceRangesForProduct(selectedProduct).map((pr) => (
              <View key={pr.id} className="bg-white rounded-xl p-4 mb-2 border border-gray-100">
                <Text className="text-base text-gray-900">
                  {pr.min_value} - {pr.max_value}
                </Text>
                <Text className="text-sm text-gray-500">
                  Par: ${pr.par_price?.toFixed(2)} | Retail: ${pr.retail_price?.toFixed(2)}
                </Text>
                <Text className="text-xs text-gray-400">
                  1yr: {pr.yr1_markup_pct}% | 30d: {pr.day30_markup_pct}% | Today: {pr.today_discount_pct}%
                </Text>
              </View>
            ))}

            <Text className="text-lg font-semibold text-gray-900 mb-3 mt-6">
              Add-ons
            </Text>
            {getAddonsForProduct(selectedProduct).map((addon) => (
              <View key={addon.id} className="bg-white rounded-xl p-4 mb-2 border border-gray-100">
                <View className="flex-row items-center justify-between">
                  <Text className="text-base font-medium text-gray-900">{addon.name}</Text>
                  <Text className="text-base text-primary font-bold">
                    ${addon.price.toFixed(2)}
                    {addon.unit ? `/${addon.unit}` : ''}
                  </Text>
                </View>
                {addon.description && (
                  <Text className="text-sm text-gray-500 mt-1">{addon.description}</Text>
                )}
                <Text className="text-xs text-gray-400 mt-1">
                  Type: {addon.pricing_type}
                  {addon.required ? ' | Required' : ''}
                </Text>
              </View>
            ))}
          </>
        )}

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
