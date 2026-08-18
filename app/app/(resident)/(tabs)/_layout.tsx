import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { useStr } from "@/state/AppState";
import { colors, fonts } from "@/ui/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function tabIcon(focused: IconName, unfocused: IconName) {
  return function TabIcon({ color, focused: isFocused }: { color: string; focused: boolean }) {
    return <Ionicons name={isFocused ? focused : unfocused} size={24} color={color} />;
  };
}

export default function ResidentTabs() {
  const str = useStr();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.line,
          height: 64,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.medium,
          fontSize: 12,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: str("app_name"),
          tabBarIcon: tabIcon("home", "home-outline"),
        }}
      />
      <Tabs.Screen
        name="usage"
        options={{
          title: str("usage.title"),
          tabBarIcon: tabIcon("stats-chart", "stats-chart-outline"),
        }}
      />
      <Tabs.Screen
        name="bags"
        options={{
          title: str("bags.title"),
          tabBarIcon: tabIcon("bag-handle", "bag-handle-outline"),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: str("settings.title"),
          tabBarIcon: tabIcon("settings", "settings-outline"),
        }}
      />
    </Tabs>
  );
}
