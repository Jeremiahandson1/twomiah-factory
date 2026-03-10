import { Tabs } from 'expo-router';
import { View, Text, Platform } from 'react-native';

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Home: '\u2302',
    New: '+',
    History: '\u2630',
    Profile: '\u263A',
  };

  return (
    <View className="items-center justify-center">
      <Text
        className={`text-2xl ${focused ? 'text-primary' : 'text-gray-400'}`}
      >
        {icons[name] || '?'}
      </Text>
      <Text
        className={`text-xs mt-1 ${
          focused ? 'text-primary font-semibold' : 'text-gray-400'
        }`}
      >
        {name}
      </Text>
    </View>
  );
}

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          height: Platform.OS === 'ios' ? 85 : 60,
          paddingBottom: Platform.OS === 'ios' ? 25 : 8,
          paddingTop: 8,
          backgroundColor: '#ffffff',
          borderTopWidth: 1,
          borderTopColor: '#e5e7eb',
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="Home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="quote"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="New" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="estimate"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="New" focused={focused} />,
          href: null,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name="History" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name="Profile" focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
