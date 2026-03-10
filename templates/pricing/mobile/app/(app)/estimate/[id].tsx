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
import { useEstimate } from '@/hooks/useEstimate';
import { usePricebook } from '@/hooks/usePricebook';
import { useEstimateStore } from '@/store/estimateStore';
import { ProductCard } from '@/components/ProductCard';
import { TierSelector } from '@/components/TierSelector';
import { AddonList } from '@/components/AddonList';
import { PriceFooter } from '@/components/PriceFooter';
import { MeasurementInput } from '@/components/MeasurementInput';

export default function EditEstimateScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    estimate,
    loading,
    loadEstimate,
    addLine,
    removeLine,
    selectTier,
    calculateEstimate,
    save,
  } = useEstimate();
  const { products, getTiersByProduct, getAddonsForProduct } = usePricebook('estimator');
  const store = useEstimateStore();

  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [length, setLength] = useState(0);
  const [width, setWidth] = useState(0);
  const [pitch, setPitch] = useState('4/12');
  const [wasteFactor, setWasteFactor] = useState(10);
  const [selectedAddons, setSelectedAddons] = useState<any[]>([]);

  useEffect(() => {
    if (id) loadEstimate(id);
  }, [id]);

  const handleAddToEstimate = async () => {
    if (!selectedProduct || length <= 0 || width <= 0) {
      Alert.alert('Missing Info', 'Please select a product and enter measurements.');
      return;
    }

    const tiers = getTiersByProduct(selectedProduct.id);
    const tierData = tiers.find((t) => t.tier === store.selectedTier) || tiers[0];

    await addLine({
      product_id: selectedProduct.id,
      product_name: selectedProduct.name,
      measurement: {
        length,
        width,
        area: length * width,
        pitch,
        waste_factor: wasteFactor,
      },
      tier: store.selectedTier,
      material_cost: tierData?.material_cost_per_unit || 0,
      labor_cost: selectedProduct.labor_rate || 0,
      setup_fee: selectedProduct.setup_fee || 0,
      addons: selectedAddons,
      line_total: 0,
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSelectedProduct(null);
    setLength(0);
    setWidth(0);
    setSelectedAddons([]);
  };

  const handlePresent = () => {
    if (!estimate) return;
    calculateEstimate();
    save();
    router.push(`/(app)/estimate/${estimate.id}/present`);
  };

  if (loading || !estimate) {
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
        <Text className="text-lg font-semibold text-gray-900">Edit Estimate</Text>
        <View className="w-16" />
      </View>

      <ScrollView className="flex-1 px-6">
        <Text className="text-base font-medium text-gray-500 mt-4 mb-2">
          {estimate.customer.name || 'No customer name'}
        </Text>

        {estimate.lines.length > 0 && (
          <View className="mb-4">
            <Text className="text-lg font-semibold text-gray-900 mb-2">Current Lines</Text>
            {estimate.lines.map((line) => (
              <View
                key={line.id}
                className="bg-white rounded-xl p-4 mb-2 border border-gray-100 flex-row items-center justify-between"
              >
                <View className="flex-1">
                  <Text className="text-base font-medium text-gray-900">
                    {line.product_name}
                  </Text>
                  <Text className="text-sm text-gray-500">
                    {line.measurement.area} sq ft - {line.tier}
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

        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            onPress={() => {
              setSelectedProduct(product);
              setLength(0);
              setWidth(0);
              setSelectedAddons([]);
            }}
            selected={selectedProduct?.id === product.id}
          />
        ))}

        {selectedProduct && (
          <>
            <View className="flex-row gap-4 mt-4 mb-4">
              <View className="flex-1">
                <Text className="text-sm text-gray-600 mb-1">Length (ft)</Text>
                <MeasurementInput value={length} unit="ft" onChange={setLength} />
              </View>
              <View className="flex-1">
                <Text className="text-sm text-gray-600 mb-1">Width (ft)</Text>
                <MeasurementInput value={width} unit="ft" onChange={setWidth} />
              </View>
            </View>

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
              onPress={handleAddToEstimate}
              activeOpacity={0.8}
            >
              <Text className="text-white text-lg font-semibold">Add to Estimate</Text>
            </TouchableOpacity>
          </>
        )}

        <View className="h-32" />
      </ScrollView>

      <PriceFooter
        lineCount={estimate.lines.length}
        total={estimate.total_price}
        actionLabel="Present"
        onAction={handlePresent}
        disabled={estimate.lines.length === 0}
      />
    </SafeAreaView>
  );
}
