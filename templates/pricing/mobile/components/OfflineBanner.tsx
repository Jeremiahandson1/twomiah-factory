import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSequence,
} from 'react-native-reanimated';

interface OfflineBannerProps {
  isOnline: boolean;
  pendingCount: number;
}

export function OfflineBanner({ isOnline, pendingCount }: OfflineBannerProps) {
  const [visible, setVisible] = useState(!isOnline);
  const [showOnline, setShowOnline] = useState(false);
  const height = useSharedValue(isOnline ? 0 : 40);

  useEffect(() => {
    if (!isOnline) {
      setVisible(true);
      setShowOnline(false);
      height.value = withTiming(40, { duration: 300 });
    } else if (visible) {
      setShowOnline(true);
      setTimeout(() => {
        height.value = withTiming(0, { duration: 300 });
        setTimeout(() => {
          setVisible(false);
          setShowOnline(false);
        }, 350);
      }, 2000);
    }
  }, [isOnline]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: height.value,
    overflow: 'hidden',
  }));

  if (!visible && isOnline) return null;

  return (
    <Animated.View style={animatedStyle}>
      <View
        className={`flex-1 flex-row items-center justify-center px-4 ${
          showOnline ? 'bg-green-500' : 'bg-red-500'
        }`}
      >
        <View
          className={`w-2 h-2 rounded-full mr-2 ${
            showOnline ? 'bg-green-200' : 'bg-red-200'
          }`}
        />
        <Text className="text-white text-sm font-medium">
          {showOnline
            ? 'Back online'
            : `No connection${pendingCount > 0 ? ` - ${pendingCount} pending` : ''}`}
        </Text>
      </View>
    </Animated.View>
  );
}
