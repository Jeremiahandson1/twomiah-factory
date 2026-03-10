import { View, Text, ActivityIndicator } from 'react-native';

interface SyncIndicatorProps {
  synced: boolean;
  syncing: boolean;
  pendingCount?: number;
}

export function SyncIndicator({ synced, syncing, pendingCount }: SyncIndicatorProps) {
  if (syncing) {
    return (
      <View className="flex-row items-center">
        <ActivityIndicator size="small" color="#f59e0b" />
      </View>
    );
  }

  if (synced) {
    return (
      <View className="w-5 h-5 bg-green-100 rounded-full items-center justify-center">
        <Text className="text-green-600 text-xs">&#10003;</Text>
      </View>
    );
  }

  return (
    <View className="relative">
      <View className="w-5 h-5 bg-red-100 rounded-full items-center justify-center">
        <View className="w-2 h-2 bg-red-500 rounded-full" />
      </View>
      {pendingCount != null && pendingCount > 0 && (
        <View className="absolute -top-1 -right-1 bg-red-500 rounded-full w-3.5 h-3.5 items-center justify-center">
          <Text className="text-white text-[8px] font-bold">
            {pendingCount > 9 ? '9+' : pendingCount}
          </Text>
        </View>
      )}
    </View>
  );
}
