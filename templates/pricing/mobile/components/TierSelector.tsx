import { useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';

interface Tier {
  id: string;
  product_id: string;
  tier: string;
  base_price: number | null;
  material_name: string | null;
  material_cost_per_unit: number | null;
  warranty_years: number | null;
  features: string | null;
}

interface TierSelectorProps {
  tiers: Tier[];
  selectedTier: string;
  onSelect: (tier: string) => void;
  showPrice?: boolean;
}

const tierOrder = ['best', 'better', 'good'];
const tierColors: Record<string, { bg: string; border: string; badge: string }> = {
  best: { bg: 'bg-emerald-50', border: 'border-emerald-500', badge: 'bg-emerald-500' },
  better: { bg: 'bg-blue-50', border: 'border-blue-500', badge: 'bg-blue-500' },
  good: { bg: 'bg-gray-50', border: 'border-gray-400', badge: 'bg-gray-400' },
};

export function TierSelector({ tiers, selectedTier, onSelect, showPrice }: TierSelectorProps) {
  const { width } = useWindowDimensions();
  const cardWidth = width * 0.7;
  const scrollRef = useRef<ScrollView>(null);

  const sortedTiers = [...tiers].sort((a, b) => {
    const aIdx = tierOrder.indexOf(a.tier.toLowerCase());
    const bIdx = tierOrder.indexOf(b.tier.toLowerCase());
    return aIdx - bIdx;
  });

  const handleSelect = (tier: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSelect(tier);
  };

  if (sortedTiers.length === 0) {
    return (
      <View className="bg-gray-50 rounded-xl p-6 items-center">
        <Text className="text-gray-400">No tiers available</Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={cardWidth + 12}
      decelerationRate="fast"
      contentContainerStyle={{ paddingRight: 24 }}
    >
      {sortedTiers.map((tier) => {
        const tierKey = tier.tier.toLowerCase();
        const isSelected = selectedTier.toLowerCase() === tierKey;
        const colors = tierColors[tierKey] || tierColors.good;

        return (
          <TouchableOpacity
            key={tier.id}
            style={{ width: cardWidth }}
            className={`rounded-2xl p-5 mr-3 border-2 ${
              isSelected ? `${colors.bg} ${colors.border}` : 'bg-white border-gray-200'
            }`}
            onPress={() => handleSelect(tier.tier)}
            activeOpacity={0.8}
          >
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg font-bold text-gray-900 capitalize">{tier.tier}</Text>
              {tierKey === 'best' && (
                <View className={`${colors.badge} px-3 py-1 rounded-full`}>
                  <Text className="text-white text-xs font-semibold">Recommended</Text>
                </View>
              )}
            </View>

            {tier.material_name && (
              <Text className="text-sm text-gray-600 mb-1">
                Material: {tier.material_name}
              </Text>
            )}

            {tier.warranty_years != null && (
              <Text className="text-sm text-gray-600 mb-1">
                Warranty: {tier.warranty_years} years
              </Text>
            )}

            {tier.features && (
              <Text className="text-sm text-gray-500 mt-1" numberOfLines={3}>
                {tier.features}
              </Text>
            )}

            {(showPrice || tier.base_price != null) && tier.base_price != null && (
              <Text className="text-2xl font-bold text-gray-900 mt-3">
                ${tier.base_price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}
