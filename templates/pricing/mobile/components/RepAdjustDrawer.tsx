import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';

interface RepAdjustDrawerProps {
  visible: boolean;
  currentTotal: number;
  onApply: (discountAmount: number) => void;
  onClose: () => void;
}

export function RepAdjustDrawer({
  visible,
  currentTotal,
  onApply,
  onClose,
}: RepAdjustDrawerProps) {
  const [mode, setMode] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [managerPin, setManagerPin] = useState('');

  const discountAmount =
    mode === 'percent'
      ? (currentTotal * (parseFloat(value) || 0)) / 100
      : parseFloat(value) || 0;

  const discountPct =
    currentTotal > 0
      ? mode === 'percent'
        ? parseFloat(value) || 0
        : ((parseFloat(value) || 0) / currentTotal) * 100
      : 0;

  const needsManagerApproval = discountPct > 15;

  const getGuardrailColor = () => {
    if (discountPct <= 5) return 'bg-green-500';
    if (discountPct <= 10) return 'bg-yellow-500';
    if (discountPct <= 15) return 'bg-amber-500';
    return 'bg-red-500';
  };

  const handleApply = () => {
    if (needsManagerApproval && managerPin.length < 4) return;
    onApply(discountAmount);
    setValue('');
    setReason('');
    setManagerPin('');
  };

  const handleClose = () => {
    setValue('');
    setReason('');
    setManagerPin('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <Pressable className="flex-1 bg-black/50" onPress={handleClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-end"
        >
          <Pressable
            className="bg-white rounded-t-3xl p-6"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="w-10 h-1 bg-gray-300 rounded-full self-center mb-4" />

            <Text className="text-xl font-bold text-gray-900 mb-6">
              Adjust Price
            </Text>

            <View className="flex-row mb-4 bg-gray-100 rounded-xl p-1">
              <TouchableOpacity
                className={`flex-1 py-3 rounded-lg items-center ${
                  mode === 'percent' ? 'bg-white' : ''
                }`}
                onPress={() => setMode('percent')}
              >
                <Text
                  className={`text-base font-medium ${
                    mode === 'percent' ? 'text-primary' : 'text-gray-500'
                  }`}
                >
                  Percentage
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className={`flex-1 py-3 rounded-lg items-center ${
                  mode === 'amount' ? 'bg-white' : ''
                }`}
                onPress={() => setMode('amount')}
              >
                <Text
                  className={`text-base font-medium ${
                    mode === 'amount' ? 'text-primary' : 'text-gray-500'
                  }`}
                >
                  Amount
                </Text>
              </TouchableOpacity>
            </View>

            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-1">
                {mode === 'percent' ? 'Discount %' : 'Discount Amount ($)'}
              </Text>
              <TextInput
                className="h-14 bg-gray-50 border border-gray-200 rounded-xl px-4 text-lg font-bold"
                placeholder={mode === 'percent' ? '0' : '0.00'}
                placeholderTextColor="#9ca3af"
                value={value}
                onChangeText={setValue}
                keyboardType="decimal-pad"
              />
            </View>

            <View className="mb-4">
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-sm text-gray-600">Discount level</Text>
                <Text className="text-sm font-medium text-gray-900">
                  {discountPct.toFixed(1)}%
                </Text>
              </View>
              <View className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <View
                  className={`h-full rounded-full ${getGuardrailColor()}`}
                  style={{ width: `${Math.min(discountPct * 3.33, 100)}%` }}
                />
              </View>
              <View className="flex-row justify-between mt-1">
                <Text className="text-xs text-gray-400">0%</Text>
                <Text className="text-xs text-gray-400">15%</Text>
                <Text className="text-xs text-gray-400">30%</Text>
              </View>
            </View>

            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-1">Reason</Text>
              <TextInput
                className="h-14 bg-gray-50 border border-gray-200 rounded-xl px-4 text-base"
                placeholder="Reason for discount"
                placeholderTextColor="#9ca3af"
                value={reason}
                onChangeText={setReason}
              />
            </View>

            {needsManagerApproval && (
              <View className="mb-4">
                <View className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
                  <Text className="text-red-700 text-sm font-medium">
                    Discount over 15% requires manager approval
                  </Text>
                </View>
                <Text className="text-sm font-medium text-gray-700 mb-1">
                  Manager PIN
                </Text>
                <TextInput
                  className="h-14 bg-gray-50 border border-gray-200 rounded-xl px-4 text-lg text-center tracking-widest"
                  placeholder="****"
                  placeholderTextColor="#9ca3af"
                  value={managerPin}
                  onChangeText={setManagerPin}
                  keyboardType="number-pad"
                  maxLength={6}
                  secureTextEntry
                />
              </View>
            )}

            <View className="bg-gray-50 rounded-xl p-4 mb-6 flex-row items-center justify-between">
              <Text className="text-base text-gray-600">New total:</Text>
              <Text className="text-xl font-bold text-gray-900">
                $
                {(currentTotal - discountAmount).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                })}
              </Text>
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 h-14 border border-gray-200 rounded-xl items-center justify-center"
                onPress={handleClose}
                activeOpacity={0.8}
              >
                <Text className="text-base font-semibold text-gray-700">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className={`flex-1 h-14 rounded-xl items-center justify-center ${
                  needsManagerApproval && managerPin.length < 4
                    ? 'bg-gray-300'
                    : 'bg-primary'
                }`}
                onPress={handleApply}
                disabled={needsManagerApproval && managerPin.length < 4}
                activeOpacity={0.8}
              >
                <Text
                  className={`text-base font-semibold ${
                    needsManagerApproval && managerPin.length < 4
                      ? 'text-gray-500'
                      : 'text-white'
                  }`}
                >
                  Apply
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
