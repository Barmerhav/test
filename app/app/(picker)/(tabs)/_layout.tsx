import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { useStr } from "@/state/AppState";
import { fonts, pickerColors as pc } from "@/ui/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function tabIcon(focused: IconName, unfocused: IconName) {
  return function TabIcon({ color, focused: isFocused }: { color: string; focused: boolean }) {
    return <Ionicons name={isFocused ? focused : unfocused} size={24} color={color} />;
  };
}

export default function PickerTabs() {
  const str = useStr();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: pc.bg },
        tabBarActiveTintColor: pc.amber,
        tabBarInactiveTintColor: pc.muted,
        tabBarStyle: {
          backgroundColor: pc.surface,
          borderTopColor: pc.line,
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
          title: str("feed.title"),
          tabBarIcon: tabIcon("flash", "flash-outline"),
        }}
      />
      <Tabs.Screen
        name="stop"
        options={{
          title: str("stop.title"),
          tabBarIcon: tabIcon("navigate", "navigate-outline"),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: str("earnings.title"),
          tabBarIcon: tabIcon("cash", "cash-outline"),
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
