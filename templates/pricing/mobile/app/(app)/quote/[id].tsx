import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useQuote } from '@/hooks/useQuote';
import { usePricebook } from '@/hooks/usePricebook';
import { useQuoteStore } from '@/store/quoteStore';
import { CategoryGrid } from '@/components/CategoryGrid';
import { ProductCard } from '@/components/ProductCard';
import { TierSelector } from '@/components/TierSelector';
import { AddonList } from '@/components/AddonList';
import { PriceFooter } from '@/components/PriceFooter';
import { MeasurementInput } from '@/components/MeasurementInput';
import { RepAdjustDrawer } from '@/components/RepAdjustDrawer';

export default function EditQuoteScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    quote,
    loading,
    loadQuote,
    setCustomer,
    addLine,
    removeLine,
    selectTier,
    setDiscount,
    save,
  } = useQuote();
  const {
    categories,
    getProductsByCategory,
    getTiersByProduct,
    getAddonsForProduct,
    getPriceRangesForProduct,
  } = usePricebook('menu');
  const store = useQuoteStore();

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [measurement, setMeasurement] = useState(0);
  const [selectedAddons, setSelectedAddons] = useState<any[]>([]);
  const [showAdjust, setShowAdjust] = useState(false);

  useEffect(() => {
    if (id) {
      loadQuote(id);
    }
  }, [id]);

  const handleAddToQuote = async () => {
    if (!selectedProduct || measurement <= 0) {
      Alert.alert('Missing Info', 'Please enter a measurement value.');
      return;
    }

    const tiers = getTiersByProduct(selectedProduct.id);
    const selectedTierData = tiers.find((t) => t.tier === store.selectedTier) || tiers[0];
    const priceRanges = getPriceRangesForProduct(selectedProduct.id);

    let basePrice = selectedTierData?.base_price || 0;
    if (priceRanges.length > 0) {
      const range = priceRanges.find(
        (pr) => measurement >= pr.min_value && measurement <= pr.max_value
      );
      if (range) basePrice = range.retail_price;
    }

    const addonTotal = selectedAddons.reduce((sum, a) => sum + a.price * a.quantity, 0);
    const lineTotal = basePrice * measurement + addonTotal;

    await addLine({
      product_id: selectedProduct.id,
      product_name: selectedProduct.name,
      measurement,
      measurement_unit: selectedProduct.measurement_unit || 'unit',
      tier: store.selectedTier,
      base_price: basePrice,
      addons: selectedAddons,
      line_total: lineTotal,
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSelectedProduct(null);
    setMeasurement(0);
    setSelectedAddons([]);
  };

  const handlePresent = () => {
    if (!quote) return;
    save();
    router.push(`/(app)/quote/${quote.id}/present`);
  };

  if (loading || !quote) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center">
        <ActivityIndicator size="large" color="#1e3a5f" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between px-6 py-3 border-b border-gray-100 bg-white">
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-primary text-base font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-lg font-semibold text-gray-900">Edit Quote</Text>
        <View className="w-16" />
      </View>

      <ScrollView className="flex-1 px-6">
        <Text className="text-base font-medium text-gray-500 mt-4 mb-2">
          {quote.customer.name || 'No customer name'}
        </Text>

        {quote.lines.length > 0 && (
          <View className="mb-4">
            <Text className="text-lg font-semibold text-gray-900 mb-2">Line Items</Text>
            {quote.lines.map((line) => (
              <View
                key={line.id}
                className="bg-white rounded-xl p-4 mb-2 border border-gray-100 flex-row items-center justify-between"
              >
                <View className="flex-1">
                  <Text className="text-base font-medium text-gray-900">
                    {line.product_name}
                  </Text>
                  <Text className="text-sm text-gray-500">
                    {line.measurement} {line.measurement_unit} - {line.tier}
                  </Text>
                </View>
                <View className="flex-row items-center gap-3">
                  <Text className="text-base font-bold text-gray-900">
                    ${line.line_total.toFixed(2)}
                  </Text>
                  <TouchableOpacity
                    onPress={() => removeLine(line.id)}
                    className="w-8 h-8 bg-red-50 rounded-full items-center justify-center"
                  >
                    <Text className="text-red-500 text-lg font-bold">-</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        <Text className="text-xl font-bold text-gray-900 mb-4 mt-2">Add Products</Text>

        <CategoryGrid
          categories={categories}
          selectedId={selectedCategory}
          onSelect={setSelectedCategory}
        />

        {selectedCategory &&
          getProductsByCategory(selectedCategory).map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onPress={() => {
                setSelectedProduct(product);
                setMeasurement(0);
                setSelectedAddons([]);
              }}
              selected={selectedProduct?.id === product.id}
            />
          ))}

        {selectedProduct && (
          <>
            <MeasurementInput
              value={measurement}
              unit={selectedProduct.measurement_unit || 'unit'}
              onChange={setMeasurement}
            />
            <TierSelector
              tiers={getTiersByProduct(selectedProduct.id)}
              selectedTier={store.selectedTier}
              onSelect={(tier) => {
                store.selectTier(tier);
                selectTier(tier);
              }}
            />
            <AddonList
              addons={getAddonsForProduct(selectedProduct.id)}
              selected={selectedAddons}
              onChange={setSelectedAddons}
            />
            <TouchableOpacity
              className="h-14 bg-success rounded-xl items-center justify-center mt-4 mb-4"
              onPress={handleAddToQuote}
              activeOpacity={0.8}
            >
              <Text className="text-white text-lg font-semibold">Add to Quote</Text>
            </TouchableOpacity>
          </>
        )}

        <View className="h-32" />
      </ScrollView>

      <PriceFooter
        lineCount={quote.lines.length}
        total={quote.total_price}
        actionLabel="Present"
        onAction={handlePresent}
        onLongPress={() => setShowAdjust(true)}
        disabled={quote.lines.length === 0}
      />

      <RepAdjustDrawer
        visible={showAdjust}
        currentTotal={quote.total_price}
        onApply={(amount) => {
          setDiscount(amount);
          setShowAdjust(false);
        }}
        onClose={() => setShowAdjust(false)}
      />
    </SafeAreaView>
  );
}
