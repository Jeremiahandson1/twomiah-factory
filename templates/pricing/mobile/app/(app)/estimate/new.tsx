import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
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

export default function NewEstimateScreen() {
  const router = useRouter();
  const {
    estimate,
    createEstimate,
    setCustomer,
    addLine,
    removeLine,
    selectTier,
    setDiscount,
    calculateEstimate,
    save,
  } = useEstimate();
  const { products, getTiersByProduct, getAddonsForProduct } = usePricebook('estimator');
  const store = useEstimateStore();

  const [step, setStep] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [length, setLength] = useState(0);
  const [width, setWidth] = useState(0);
  const [pitch, setPitch] = useState('4/12');
  const [wasteFactor, setWasteFactor] = useState(10);
  const [selectedAddons, setSelectedAddons] = useState<any[]>([]);

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerState, setCustomerState] = useState('');
  const [referralSource, setReferralSource] = useState('');
  const [referralName, setReferralName] = useState('');

  useEffect(() => {
    createEstimate();
    store.reset();
  }, []);

  const pitchOptions = [
    '2/12', '3/12', '4/12', '5/12', '6/12', '7/12',
    '8/12', '9/12', '10/12', '11/12', '12/12',
  ];

  const handleSaveCustomer = () => {
    setCustomer({
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      address: customerAddress,
      state: customerState,
      referral_source: referralSource,
      referral_name: referralName,
    });
    setStep(1);
  };

  const handleAddToEstimate = async () => {
    if (!selectedProduct) {
      Alert.alert('Missing Info', 'Please select a product.');
      return;
    }
    if (length <= 0 || width <= 0) {
      Alert.alert('Missing Info', 'Please enter length and width.');
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

  const handleCalculate = () => {
    calculateEstimate();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStep(2);
  };

  const handlePresent = () => {
    if (!estimate) return;
    save();
    router.push(`/(app)/estimate/${estimate.id}/present`);
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            className="flex-1"
          >
            <ScrollView className="flex-1 px-6" keyboardShouldPersistTaps="handled">
              <Text className="text-xl font-bold text-gray-900 mb-6 mt-4">
                Customer Information
              </Text>

              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-1">Name *</Text>
                <TextInput
                  className="h-14 bg-gray-50 border border-gray-200 rounded-xl px-4 text-base"
                  placeholder="Customer name"
                  placeholderTextColor="#9ca3af"
                  value={customerName}
                  onChangeText={setCustomerName}
                />
              </View>
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-1">Email</Text>
                <TextInput
                  className="h-14 bg-gray-50 border border-gray-200 rounded-xl px-4 text-base"
                  placeholder="Email"
                  placeholderTextColor="#9ca3af"
                  value={customerEmail}
                  onChangeText={setCustomerEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-1">Phone</Text>
                <TextInput
                  className="h-14 bg-gray-50 border border-gray-200 rounded-xl px-4 text-base"
                  placeholder="Phone"
                  placeholderTextColor="#9ca3af"
                  value={customerPhone}
                  onChangeText={setCustomerPhone}
                  keyboardType="phone-pad"
                />
              </View>
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-1">Address</Text>
                <TextInput
                  className="h-14 bg-gray-50 border border-gray-200 rounded-xl px-4 text-base"
                  placeholder="Address"
                  placeholderTextColor="#9ca3af"
                  value={customerAddress}
                  onChangeText={setCustomerAddress}
                />
              </View>
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-1">State</Text>
                <TextInput
                  className="h-14 bg-gray-50 border border-gray-200 rounded-xl px-4 text-base"
                  placeholder="State"
                  placeholderTextColor="#9ca3af"
                  value={customerState}
                  onChangeText={setCustomerState}
                  autoCapitalize="characters"
                />
              </View>
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-1">Referral Source</Text>
                <TextInput
                  className="h-14 bg-gray-50 border border-gray-200 rounded-xl px-4 text-base"
                  placeholder="Referral source"
                  placeholderTextColor="#9ca3af"
                  value={referralSource}
                  onChangeText={setReferralSource}
                />
              </View>
              <View className="mb-8">
                <Text className="text-sm font-medium text-gray-700 mb-1">Referral Name</Text>
                <TextInput
                  className="h-14 bg-gray-50 border border-gray-200 rounded-xl px-4 text-base"
                  placeholder="Referral name"
                  placeholderTextColor="#9ca3af"
                  value={referralName}
                  onChangeText={setReferralName}
                />
              </View>

              <TouchableOpacity
                className="h-14 bg-primary rounded-xl items-center justify-center mb-8"
                onPress={handleSaveCustomer}
                activeOpacity={0.8}
              >
                <Text className="text-white text-lg font-semibold">Next</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        );

      case 1:
        return (
          <View className="flex-1">
            <ScrollView className="flex-1 px-6">
              <Text className="text-xl font-bold text-gray-900 mb-4 mt-4">
                Select Products
              </Text>

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
                  <Text className="text-lg font-semibold text-gray-900 mb-3 mt-6">
                    Measurements
                  </Text>
                  <View className="flex-row gap-4 mb-4">
                    <View className="flex-1">
                      <Text className="text-sm text-gray-600 mb-1">Length</Text>
                      <MeasurementInput
                        value={length}
                        unit="ft"
                        onChange={setLength}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm text-gray-600 mb-1">Width</Text>
                      <MeasurementInput
                        value={width}
                        unit="ft"
                        onChange={setWidth}
                      />
                    </View>
                  </View>

                  {length > 0 && width > 0 && (
                    <Text className="text-base text-gray-600 mb-4">
                      Area: {(length * width).toFixed(0)} sq ft
                    </Text>
                  )}

                  {selectedProduct.pitch_adjustable === 1 && (
                    <>
                      <Text className="text-lg font-semibold text-gray-900 mb-3">
                        Pitch
                      </Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
                        {pitchOptions.map((p) => (
                          <TouchableOpacity
                            key={p}
                            className={`px-4 py-3 rounded-xl mr-2 ${
                              pitch === p ? 'bg-primary' : 'bg-gray-100'
                            }`}
                            onPress={() => {
                              setPitch(p);
                              Haptics.selectionAsync();
                            }}
                          >
                            <Text
                              className={`text-base font-medium ${
                                pitch === p ? 'text-white' : 'text-gray-700'
                              }`}
                            >
                              {p}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </>
                  )}

                  <Text className="text-lg font-semibold text-gray-900 mb-2">
                    Waste Factor: {wasteFactor}%
                  </Text>
                  <View className="flex-row items-center gap-4 mb-4">
                    <TouchableOpacity
                      className="w-14 h-14 bg-gray-100 rounded-xl items-center justify-center"
                      onPress={() => {
                        setWasteFactor(Math.max(0, wasteFactor - 1));
                        Haptics.selectionAsync();
                      }}
                    >
                      <Text className="text-2xl text-gray-700">-</Text>
                    </TouchableOpacity>
                    <View className="flex-1 h-2 bg-gray-200 rounded-full">
                      <View
                        className="h-2 bg-primary rounded-full"
                        style={{ width: `${Math.min(wasteFactor * 2, 100)}%` }}
                      />
                    </View>
                    <TouchableOpacity
                      className="w-14 h-14 bg-gray-100 rounded-xl items-center justify-center"
                      onPress={() => {
                        setWasteFactor(Math.min(50, wasteFactor + 1));
                        Haptics.selectionAsync();
                      }}
                    >
                      <Text className="text-2xl text-gray-700">+</Text>
                    </TouchableOpacity>
                  </View>

                  <Text className="text-lg font-semibold text-gray-900 mb-3">
                    Select Tier
                  </Text>
                  <TierSelector
                    tiers={getTiersByProduct(selectedProduct.id)}
                    selectedTier={store.selectedTier}
                    onSelect={(tier) => {
                      store.selectTier(tier);
                      selectTier(tier);
                    }}
                  />

                  <Text className="text-lg font-semibold text-gray-900 mb-3 mt-4">
                    Add-ons
                  </Text>
                  <AddonList
                    addons={getAddonsForProduct(selectedProduct.id)}
                    selected={selectedAddons}
                    onChange={setSelectedAddons}
                  />

                  <TouchableOpacity
                    className="h-14 bg-success rounded-xl items-center justify-center mt-6 mb-4"
                    onPress={handleAddToEstimate}
                    activeOpacity={0.8}
                  >
                    <Text className="text-white text-lg font-semibold">
                      Add to Estimate
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {(estimate?.lines.length || 0) > 0 && (
                <TouchableOpacity
                  className="h-14 bg-primary rounded-xl items-center justify-center mt-4 mb-4"
                  onPress={handleCalculate}
                  activeOpacity={0.8}
                >
                  <Text className="text-white text-lg font-semibold">
                    Calculate Estimate
                  </Text>
                </TouchableOpacity>
              )}

              <View className="h-32" />
            </ScrollView>

            <PriceFooter
              lineCount={estimate?.lines.length || 0}
              total={estimate?.total_price || 0}
              actionLabel="Calculate"
              onAction={handleCalculate}
              disabled={(estimate?.lines.length || 0) === 0}
            />
          </View>
        );

      case 2:
        return (
          <View className="flex-1">
            <ScrollView className="flex-1 px-6">
              <Text className="text-xl font-bold text-gray-900 mb-4 mt-4">
                Estimate Results
              </Text>

              <Text className="text-lg font-semibold text-gray-900 mb-3">
                Tier Comparison
              </Text>
              <TierSelector
                tiers={
                  estimate?.tier_breakdowns.map((tb) => ({
                    id: tb.tier,
                    product_id: '',
                    tier: tb.tier,
                    base_price: tb.total,
                    material_name: null,
                    material_cost_per_unit: tb.material_cost,
                    warranty_years: null,
                    features: null,
                  })) || []
                }
                selectedTier={estimate?.selected_tier || 'best'}
                onSelect={(tier) => selectTier(tier)}
                showPrice
              />

              <View className="bg-white rounded-2xl p-6 mt-6 border border-gray-100">
                <Text className="text-lg font-semibold text-gray-900 mb-4">
                  Breakdown
                </Text>
                {estimate?.lines.map((line, i) => (
                  <View key={i} className="mb-3 pb-3 border-b border-gray-50">
                    <Text className="text-base font-medium text-gray-900">
                      {line.product_name}
                    </Text>
                    <Text className="text-sm text-gray-500">
                      {line.measurement.area} sq ft (pitch: {line.measurement.pitch},
                      waste: {line.measurement.waste_factor}%)
                    </Text>
                    <Text className="text-base font-bold text-gray-900 mt-1">
                      ${line.line_total.toFixed(2)}
                    </Text>
                  </View>
                ))}
                <View className="flex-row justify-between mt-4 pt-4 border-t border-gray-200">
                  <Text className="text-xl font-bold text-gray-900">Total</Text>
                  <Text className="text-xl font-bold text-primary">
                    ${(estimate?.total_price || 0).toFixed(2)}
                  </Text>
                </View>
              </View>

              <View className="h-32" />
            </ScrollView>

            <PriceFooter
              lineCount={estimate?.lines.length || 0}
              total={estimate?.total_price || 0}
              actionLabel="Present"
              onAction={handlePresent}
              disabled={(estimate?.lines.length || 0) === 0}
            />
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between px-6 py-3 border-b border-gray-100 bg-white">
        <TouchableOpacity
          onPress={() => {
            if (step > 0) setStep(step - 1);
            else router.back();
          }}
        >
          <Text className="text-primary text-base font-medium">
            {step > 0 ? 'Back' : 'Cancel'}
          </Text>
        </TouchableOpacity>
        <Text className="text-lg font-semibold text-gray-900">New Estimate</Text>
        <View className="w-16" />
      </View>
      {renderStep()}
    </SafeAreaView>
  );
}
