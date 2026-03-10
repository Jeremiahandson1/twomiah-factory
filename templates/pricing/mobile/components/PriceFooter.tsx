import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface PriceFooterProps {
  lineCount: number;
  total: number;
  actionLabel: string;
  onAction: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
}

export function PriceFooter({
  lineCount,
  total,
  actionLabel,
  onAction,
  onLongPress,
  disabled,
}: PriceFooterProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="bg-gray-900 border-t border-gray-800"
      style={{ paddingBottom: insets.bottom || 8 }}
    >
      <View className="flex-row items-center justify-between px-6 py-4">
        <TouchableOpacity
          onLongPress={onLongPress}
          activeOpacity={1}
          className="flex-1"
        >
          <Text className="text-gray-400 text-sm">
            {lineCount} {lineCount === 1 ? 'item' : 'items'}
          </Text>
          <Text className="text-white text-2xl font-bold">
            ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          className={`px-8 py-4 rounded-xl ml-4 ${
            disabled ? 'bg-gray-700' : 'bg-primary'
          }`}
          onPress={onAction}
          disabled={disabled}
          activeOpacity={0.8}
        >
          <Text
            className={`text-lg font-semibold ${
              disabled ? 'text-gray-500' : 'text-white'
            }`}
          >
            {actionLabel}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
