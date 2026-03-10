import { View, Text } from 'react-native';
import { type ReactNode } from 'react';

interface PresentSlideProps {
  title: string;
  children: ReactNode;
}

export function PresentSlide({ title, children }: PresentSlideProps) {
  return (
    <View className="flex-1 bg-gray-900">
      <View className="px-12 pt-8">
        <Text className="text-3xl font-bold text-white">{title}</Text>
        <View className="w-16 h-1 bg-primary mt-3 rounded-full" />
      </View>
      {children}
    </View>
  );
}
