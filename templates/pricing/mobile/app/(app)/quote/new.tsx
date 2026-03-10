import { useEffect, useState, useCallback } from 'react';
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

export default function NewQuoteScreen() {
  const router = useRouter();
  const {
    quote,
    createQuote,
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

  const [step, setStep] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [measurement, setMeasurement] = useState(0);
  const [selectedAddons, setSelectedAddons] = useState<
    { addon_id: string; name: string; price: number; quantity: number }[]
  >([]);
  const [showAdjust, setShowAdjust] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerState, setCustomerState] = useState('');
  const [referralSource, setReferralSource] = useState('');
  const [referralName, setReferralName] = useState('');

  useEffect(() => {
    createQuote('menu');
    store.reset();
    store.setMode('menu');
  }, []);

  const handleCategorySelect = (categoryId: string) => {
    setSelectedCategory(categoryId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleProductSelect = (product: any) => {
    setSelectedProduct(product);
    setMeasurement(0);
    setSelectedAddons([]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

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
      if (range) {
        basePrice = range.retail_price;
      }
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
    store.setCustomer({
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

  const handlePresent = () => {
    if (!quote) return;
    save();
    router.push(`/(app)/quote/${quote.id}/present`);
  };

  const handleApplyDiscount = (amount: number) => {
    setDiscount(amount);
    setShowAdjust(false);
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
                  placeholder="Email address"
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
                  placeholder="Phone number"
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
                  placeholder="Street address"
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
                  placeholder="How did they hear about us?"
                  placeholderTextColor="#9ca3af"
                  value={referralSource}
                  onChangeText={setReferralSource}
                />
              </View>

              <View className="mb-8">
                <Text className="text-sm font-medium text-gray-700 mb-1">Referral Name</Text>
                <TextInput
                  className="h-14 bg-gray-50 border border-gray-200 rounded-xl px-4 text-base"
                  placeholder="Who referred them?"
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
                Select Category
              </Text>
              <CategoryGrid
                categories={categories}
                selectedId={selectedCategory}
                onSelect={handleCategorySelect}
              />

              {selectedCategory && (
                <>
                  <Text className="text-lg font-semibold text-gray-900 mb-3 mt-6">
                    Products
                  </Text>
                  {getProductsByCategory(selectedCategory).map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      onPress={() => handleProductSelect(product)}
                      selected={selectedProduct?.id === product.id}
                    />
                  ))}
                </>
              )}

              {selectedProduct && (
                <>
                  <Text className="text-lg font-semibold text-gray-900 mb-3 mt-6">
                    Measurement
                  </Text>
                  <MeasurementInput
                    value={measurement}
                    unit={selectedProduct.measurement_unit || 'unit'}
                    onChange={setMeasurement}
                  />

                  <Text className="text-lg font-semibold text-gray-900 mb-3 mt-6">
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

                  <Text className="text-lg font-semibold text-gray-900 mb-3 mt-6">
                    Add-ons
                  </Text>
                  <AddonList
                    addons={getAddonsForProduct(selectedProduct.id)}
                    selected={selectedAddons}
                    onChange={setSelectedAddons}
                  />

                  <TouchableOpacity
                    className="h-14 bg-success rounded-xl items-center justify-center mt-6 mb-4"
                    onPress={handleAddToQuote}
                    activeOpacity={0.8}
                  >
                    <Text className="text-white text-lg font-semibold">
                      Add to Quote
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              <View className="h-32" />
            </ScrollView>

            <PriceFooter
              lineCount={quote?.lines.length || 0}
              total={quote?.total_price || 0}
              actionLabel="Present"
              onAction={handlePresent}
              onLongPress={() => setShowAdjust(true)}
              disabled={(quote?.lines.length || 0) === 0}
            />

            <RepAdjustDrawer
              visible={showAdjust}
              currentTotal={quote?.total_price || 0}
              onApply={handleApplyDiscount}
              onClose={() => setShowAdjust(false)}
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
            if (step > 0) {
              setStep(step - 1);
            } else {
              router.back();
            }
          }}
        >
          <Text className="text-primary text-base font-medium">
            {step > 0 ? 'Back' : 'Cancel'}
          </Text>
        </TouchableOpacity>
        <Text className="text-lg font-semibold text-gray-900">New Quote</Text>
        <View className="w-16" />
      </View>
      {renderStep()}
    </SafeAreaView>
  );
}
