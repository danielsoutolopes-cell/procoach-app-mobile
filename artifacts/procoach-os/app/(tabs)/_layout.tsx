import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

import { useColors } from "@/hooks/useColors";

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Hoje</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="plano">
        <Icon sf={{ default: "calendar", selected: "calendar.badge.checkmark" }} />
        <Label>Plano</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="provas">
        <Icon sf={{ default: "trophy", selected: "trophy.fill" }} />
        <Label>Provas</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="proximo-treino">
        <Icon sf={{ default: "clock", selected: "clock.fill" }} />
        <Label>Próximo</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="historico">
        <Icon sf={{ default: "chart.bar.fill", selected: "chart.bar.fill" }} />
        <Label>Histórico</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="equipamentos">
        <Icon sf={{ default: "figure.run", selected: "figure.run" }} />
        <Label>Tênis</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="status">
        <Icon sf={{ default: "checkmark.circle", selected: "checkmark.circle.fill" }} />
        <Label>Check-in</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : "#0A0A0A",
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: "#0A0A0A" }]}
            />
          ) : null,
        tabBarLabelStyle: {
          fontSize: 8,
          letterSpacing: 0.5,
          fontWeight: "700",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "HOJE",
          tabBarIcon: ({ color }) => (
            <Feather name="home" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="plano"
        options={{
          title: "PLANO",
          tabBarIcon: ({ color }) => (
            <Feather name="calendar" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="provas"
        options={{
          title: "PROVAS",
          tabBarIcon: ({ color }) => (
            <Feather name="award" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="proximo-treino"
        options={{
          title: "PRÓXIMO",
          tabBarIcon: ({ color }) => (
            <Feather name="clock" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="historico"
        options={{
          title: "HISTÓRICO",
          tabBarIcon: ({ color }) => (
            <Feather name="bar-chart-2" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="equipamentos"
        options={{
          title: "TÊNIS",
          tabBarIcon: ({ color }) => (
            <Feather name="shopping-bag" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="status"
        options={{
          title: "CHECK-IN",
          tabBarIcon: ({ color }) => (
            <Feather name="check-circle" size={20} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
