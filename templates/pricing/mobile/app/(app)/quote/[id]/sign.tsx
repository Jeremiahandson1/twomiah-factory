import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuote } from '@/hooks/useQuote';
import { SignaturePad } from '@/components/SignaturePad';

type SignStep = 'rescission' | 'contract' | 'customer_sign' | 'rep_sign' | 'complete';

export default function SignQuoteScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { quote, loadQuote, setSignature, setRepSignature, setStatus, save } = useQuote();
  const [step, setStep] = useState<SignStep>('rescission');
  const [rescissionAcknowledged, setRescissionAcknowledged] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) loadQuote(id);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, [id]);

  const handleScrollEnd = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const isAtBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 40;
    if (isAtBottom) setScrolledToBottom(true);
  };

  const handleCustomerSign = async (svgPath: string) => {
    setSignature(svgPath);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep('rep_sign');
  };

  const handleRepSign = async (svgPath: string) => {
    setSaving(true);
    setRepSignature(svgPath);

    try {
      const contractData = JSON.stringify({
        quoteId: quote?.id,
        customerName: quote?.customer.name,
        total: quote?.total_price,
        lines: quote?.lines,
        timestamp: new Date().toISOString(),
      });

      const hash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        contractData
      );

      if (quote) {
        quote.contract_hash = hash;
        quote.signed_at = new Date().toISOString();
      }

      setStatus('signed');
      save();

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep('complete');
    } catch (err) {
      Alert.alert('Error', 'Failed to finalize contract. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!quote) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#1e3a5f" />
      </SafeAreaView>
    );
  }

  const formatCurrency = (amount: number) =>
    `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  return (
    <View className="flex-1 bg-white">
      {step === 'rescission' && (
        <View className="flex-1 p-6">
          <Text className="text-2xl font-bold text-gray-900 mb-4">
            Right of Rescission Notice
          </Text>
          <ScrollView
            className="flex-1 bg-gray-50 rounded-xl p-4 mb-4"
            onScroll={handleScrollEnd}
            scrollEventThrottle={16}
          >
            <Text className="text-base text-gray-700 leading-6">
              NOTICE OF RIGHT TO CANCEL{'\n\n'}
              You are entering into a transaction on {new Date().toLocaleDateString()}.{'\n\n'}
              You may cancel this transaction, without any penalty or obligation,
              within three (3) business days from the above date.{'\n\n'}
              If you cancel, any property traded in, any payments made by you under
              the contract or sale, and any negotiable instrument executed by you
              will be returned within ten (10) business days following receipt by the
              seller of your cancellation notice.{'\n\n'}
              If you cancel, you must make available to the seller at your residence,
              in substantially as good condition as when received, any goods delivered
              to you under this contract or sale; or you may, if you wish, comply with
              the instructions of the seller regarding the return shipment of the goods
              at the seller's expense and risk.{'\n\n'}
              To cancel this transaction, mail or deliver a signed and dated copy of
              this cancellation notice, or any other written notice, to the seller at
              the address shown, not later than midnight of the third business day
              after the date of this transaction.{'\n\n'}
              I HEREBY ACKNOWLEDGE RECEIPT OF THIS NOTICE OF RIGHT TO CANCEL.
            </Text>
          </ScrollView>
          <TouchableOpacity
            className={`h-14 rounded-xl items-center justify-center ${
              scrolledToBottom ? 'bg-primary' : 'bg-gray-300'
            }`}
            onPress={() => {
              if (scrolledToBottom) {
                setRescissionAcknowledged(true);
                setStep('contract');
              }
            }}
            disabled={!scrolledToBottom}
            activeOpacity={0.8}
          >
            <Text className={`text-lg font-semibold ${scrolledToBottom ? 'text-white' : 'text-gray-500'}`}>
              I Acknowledge
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'contract' && (
        <View className="flex-1 p-6">
          <Text className="text-2xl font-bold text-gray-900 mb-4">Contract Review</Text>
          <ScrollView className="flex-1 bg-gray-50 rounded-xl p-4 mb-4">
            <Text className="text-lg font-bold text-gray-900 mb-4">Service Agreement</Text>
            <Text className="text-base text-gray-700 mb-2">
              Customer: {quote.customer.name}
            </Text>
            <Text className="text-base text-gray-700 mb-2">
              Address: {quote.customer.address}
            </Text>
            <Text className="text-base text-gray-700 mb-4">
              Date: {new Date().toLocaleDateString()}
            </Text>

            <Text className="text-lg font-semibold text-gray-900 mb-2">Scope of Work</Text>
            {quote.lines.map((line, i) => (
              <View key={i} className="mb-2 pl-4">
                <Text className="text-base text-gray-700">
                  - {line.product_name}: {line.measurement} {line.measurement_unit} ({line.tier} tier) - {formatCurrency(line.line_total)}
                </Text>
                {line.addons.map((addon, j) => (
                  <Text key={j} className="text-sm text-gray-500 pl-4">
                    + {addon.name}: {formatCurrency(addon.price * addon.quantity)}
                  </Text>
                ))}
              </View>
            ))}

            <View className="border-t border-gray-200 mt-4 pt-4">
              <View className="flex-row justify-between mb-1">
                <Text className="text-base text-gray-700">Subtotal:</Text>
                <Text className="text-base text-gray-900 font-medium">
                  {formatCurrency(quote.subtotal)}
                </Text>
              </View>
              {quote.discount_amount > 0 && (
                <View className="flex-row justify-between mb-1">
                  <Text className="text-base text-green-600">Discount:</Text>
                  <Text className="text-base text-green-600 font-medium">
                    -{formatCurrency(quote.discount_amount)}
                  </Text>
                </View>
              )}
              <View className="flex-row justify-between mt-2 pt-2 border-t border-gray-200">
                <Text className="text-lg font-bold text-gray-900">Total:</Text>
                <Text className="text-lg font-bold text-gray-900">
                  {formatCurrency(quote.total_price)}
                </Text>
              </View>
            </View>

            <Text className="text-sm text-gray-500 mt-6 leading-5">
              By signing below, the customer agrees to the scope of work and pricing
              described above. This agreement is subject to the terms and conditions
              provided separately. Payment terms and scheduling will be arranged upon
              execution of this agreement.
            </Text>
          </ScrollView>
          <TouchableOpacity
            className="h-14 bg-primary rounded-xl items-center justify-center"
            onPress={() => setStep('customer_sign')}
            activeOpacity={0.8}
          >
            <Text className="text-white text-lg font-semibold">Proceed to Sign</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'customer_sign' && (
        <View className="flex-1 p-6">
          <Text className="text-2xl font-bold text-gray-900 mb-2">Customer Signature</Text>
          <Text className="text-base text-gray-500 mb-4">
            {quote.customer.name}, please sign below to accept this agreement.
          </Text>
          <SignaturePad onSave={handleCustomerSign} />
        </View>
      )}

      {step === 'rep_sign' && (
        <View className="flex-1 p-6">
          <Text className="text-2xl font-bold text-gray-900 mb-2">
            Sales Representative Signature
          </Text>
          <Text className="text-base text-gray-500 mb-4">
            Representative, please sign below to confirm this agreement.
          </Text>
          {saving ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color="#1e3a5f" />
              <Text className="text-gray-500 mt-4">Finalizing contract...</Text>
            </View>
          ) : (
            <SignaturePad onSave={handleRepSign} />
          )}
        </View>
      )}

      {step === 'complete' && (
        <View className="flex-1 items-center justify-center p-6">
          <View className="w-24 h-24 bg-success rounded-full items-center justify-center mb-6">
            <Text className="text-white text-5xl">&#10003;</Text>
          </View>
          <Text className="text-3xl font-bold text-gray-900 mb-2">Contract Signed</Text>
          <Text className="text-base text-gray-500 mb-2">
            {quote.customer.name} - {formatCurrency(quote.total_price)}
          </Text>
          <Text className="text-sm text-gray-400 mb-8">
            Hash: {quote.contract_hash?.substring(0, 16)}...
          </Text>
          <TouchableOpacity
            className="h-14 bg-primary rounded-xl items-center justify-center px-12"
            onPress={() => router.replace('/(app)')}
            activeOpacity={0.8}
          >
            <Text className="text-white text-lg font-semibold">Done</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
