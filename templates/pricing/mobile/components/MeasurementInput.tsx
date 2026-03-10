import { View, Text, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';

interface MeasurementInputProps {
  value: number;
  unit: string;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
}

export function MeasurementInput({
  value,
  unit,
  onChange,
  step = 1,
  min = 0,
  max = 99999,
}: MeasurementInputProps) {
  const handleIncrement = () => {
    const newValue = Math.min(max, value + step);
    onChange(newValue);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleDecrement = () => {
    const newValue = Math.max(min, value - step);
    onChange(newValue);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleBigIncrement = () => {
    const newValue = Math.min(max, value + step * 10);
    onChange(newValue);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleBigDecrement = () => {
    const newValue = Math.max(min, value - step * 10);
    onChange(newValue);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  return (
    <View className="bg-white rounded-2xl p-4 border border-gray-100">
      <View className="flex-row items-center justify-center">
        <TouchableOpacity
          className="w-15 h-15 bg-gray-100 rounded-xl items-center justify-center"
          style={{ width: 60, height: 60 }}
          onPress={handleBigDecrement}
          onLongPress={handleBigDecrement}
          activeOpacity={0.7}
        >
          <Text className="text-gray-700 text-xl font-bold">--</Text>
        </TouchableOpacity>

        <TouchableOpacity
          className="w-15 h-15 bg-gray-100 rounded-xl items-center justify-center ml-2"
          style={{ width: 60, height: 60 }}
          onPress={handleDecrement}
          activeOpacity={0.7}
        >
          <Text className="text-gray-700 text-2xl font-bold">-</Text>
        </TouchableOpacity>

        <View className="flex-1 items-center mx-4">
          <Text className="text-4xl font-bold text-gray-900">
            {Number.isInteger(value) ? value : value.toFixed(1)}
          </Text>
          <Text className="text-sm text-gray-500 mt-1">{unit}</Text>
        </View>

        <TouchableOpacity
          className="w-15 h-15 bg-gray-100 rounded-xl items-center justify-center mr-2"
          style={{ width: 60, height: 60 }}
          onPress={handleIncrement}
          activeOpacity={0.7}
        >
          <Text className="text-gray-700 text-2xl font-bold">+</Text>
        </TouchableOpacity>

        <TouchableOpacity
          className="w-15 h-15 bg-gray-100 rounded-xl items-center justify-center"
          style={{ width: 60, height: 60 }}
          onPress={handleBigIncrement}
          onLongPress={handleBigIncrement}
          activeOpacity={0.7}
        >
          <Text className="text-gray-700 text-xl font-bold">++</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
