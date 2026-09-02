import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '@/theme';

/* A small filled square instead of an icon font: the tab bar reads as part of
 * the same terminal-green system, and it keeps the dependency list to what
 * Expo already ships. */
function Marker({ color, focused }: { color: string; focused: boolean }) {
  return (
    <View
      style={[
        styles.marker,
        { borderColor: color, backgroundColor: focused ? color : 'transparent' },
      ]}
    />
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerStyle: styles.header,
          headerTintColor: colors.acid,
          headerTitleStyle: styles.headerTitle,
          headerShadowVisible: false,
          tabBarStyle: styles.tabBar,
          tabBarActiveTintColor: colors.acid,
          tabBarInactiveTintColor: colors.dim2,
          tabBarLabelStyle: styles.tabLabel,
          // The screen background is set by <Screen> itself rather than here,
          // because this option was renamed between React Navigation 6 and 7.
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'J3NSONTOP',
            tabBarLabel: 'Load',
            tabBarIcon: ({ color, focused }) => <Marker color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="apklab"
          options={{
            title: 'APK Lab',
            tabBarLabel: 'Lab',
            tabBarIcon: ({ color, focused }) => <Marker color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="integrity"
          options={{
            title: 'Integrity',
            tabBarLabel: 'Integrity',
            tabBarIcon: ({ color, focused }) => <Marker color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="vr"
          options={{
            title: 'VR Compatibility',
            tabBarLabel: 'VR',
            tabBarIcon: ({ color, focused }) => <Marker color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="intel"
          options={{
            title: 'Intel',
            tabBarLabel: 'Intel',
            tabBarIcon: ({ color, focused }) => <Marker color={color} focused={focused} />,
          }}
        />
      </Tabs>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.ink2 },
  headerTitle: { color: colors.acid, fontWeight: '800', letterSpacing: 2, fontSize: 15 },
  tabBar: {
    backgroundColor: colors.ink2,
    borderTopColor: colors.line,
    borderTopWidth: 1,
  },
  tabLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  marker: { width: 11, height: 11, borderWidth: 1.5, borderRadius: 2 },
});
