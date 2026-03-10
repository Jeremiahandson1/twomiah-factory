import { View, Text, Switch, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';

interface Addon {
  id: string;
  product_id: string;
  group_name: string | null;
  name: string;
  description: string | null;
  pricing_type: string;
  price: number;
  unit: string | null;
  required: number;
  default_selected: number;
  sort_order: number;
}

interface SelectedAddon {
  addon_id: string;
  name: string;
  price: number;
  quantity: number;
}

interface AddonListProps {
  addons: Addon[];
  selected: SelectedAddon[];
  onChange: (selected: SelectedAddon[]) => void;
}

export function AddonList({ addons, selected, onChange }: AddonListProps) {
  const isSelected = (addonId: string) =>
    selected.some((s) => s.addon_id === addonId);

  const getQuantity = (addonId: string) =>
    selected.find((s) => s.addon_id === addonId)?.quantity || 1;

  const toggleAddon = (addon: Addon) => {
    Haptics.selectionAsync();
    if (isSelected(addon.id)) {
      onChange(selected.filter((s) => s.addon_id !== addon.id));
    } else {
      onChange([
        ...selected,
        {
          addon_id: addon.id,
          name: addon.name,
          price: addon.price,
          quantity: 1,
        },
      ]);
    }
  };

  const updateQuantity = (addonId: string, delta: number) => {
    Haptics.selectionAsync();
    onChange(
      selected.map((s) => {
        if (s.addon_id !== addonId) return s;
        const newQty = Math.max(1, s.quantity + delta);
        return { ...s, quantity: newQty };
      })
    );
  };

  if (addons.length === 0) {
    return (
      <View className="bg-gray-50 rounded-xl p-4 items-center">
        <Text className="text-gray-400 text-sm">No add-ons available</Text>
      </View>
    );
  }

  let currentGroup: string | null = null;

  return (
    <View>
      {addons.map((addon) => {
        const showGroupHeader =
          addon.group_name && addon.group_name !== currentGroup;
        if (addon.group_name) currentGroup = addon.group_name;

        return (
          <View key={addon.id}>
            {showGroupHeader && (
              <Text className="text-sm font-semibold text-gray-500 mt-3 mb-2 uppercase">
                {addon.group_name}
              </Text>
            )}
            <View className="bg-white rounded-xl p-4 mb-2 border border-gray-100">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 mr-3">
                  <Text className="text-base font-medium text-gray-900">
                    {addon.name}
                    {addon.required ? ' *' : ''}
                  </Text>
                  {addon.description && (
                    <Text className="text-sm text-gray-500 mt-0.5" numberOfLines={2}>
                      {addon.description}
                    </Text>
                  )}
                  <Text className="text-sm text-primary font-semibold mt-1">
                    ${addon.price.toFixed(2)}
                    {addon.unit ? `/${addon.unit}` : ''}
                  </Text>
                </View>

                <Switch
                  value={isSelected(addon.id) || addon.required === 1}
                  onValueChange={() => {
                    if (addon.required !== 1) toggleAddon(addon);
                  }}
                  trackColor={{ false: '#d1d5db', true: '#1e3a5f' }}
                  thumbColor="#ffffff"
                  disabled={addon.required === 1}
                />
              </View>

              {isSelected(addon.id) && addon.pricing_type === 'per_unit' && (
                <View className="flex-row items-center mt-3 pt-3 border-t border-gray-100">
                  <Text className="text-sm text-gray-600 mr-3">Qty:</Text>
                  <TouchableOpacity
                    className="w-10 h-10 bg-gray-100 rounded-lg items-center justify-center"
                    onPress={() => updateQuantity(addon.id, -1)}
                  >
                    <Text className="text-lg text-gray-700">-</Text>
                  </TouchableOpacity>
                  <Text className="text-base font-semibold text-gray-900 mx-4">
                    {getQuantity(addon.id)}
                  </Text>
                  <TouchableOpacity
                    className="w-10 h-10 bg-gray-100 rounded-lg items-center justify-center"
                    onPress={() => updateQuantity(addon.id, 1)}
                  >
                    <Text className="text-lg text-gray-700">+</Text>
                  </TouchableOpacity>
                  <Text className="text-sm text-gray-500 ml-auto">
                    = ${(addon.price * getQuantity(addon.id)).toFixed(2)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
