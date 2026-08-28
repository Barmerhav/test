import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { useStr } from "@/state/AppState";
import { colors, fonts } from "@/ui/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function tabIcon(focused: IconName, unfocused: IconName) {
  return function TabIcon({ color, focused: isFocused }: { color: string; focused: boolean }) {
    return <Ionicons name={isFocused ? focused : unfocused} size={22} color={color} />;
  };
}

/** Resident tabs per the design: בית / שימוש / שקיות / הזמינו. */
export default function ResidentTabs() {
  const str = useStr();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.lineAlt,
          height: 64,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.bold,
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: str("home.tab"),
          tabBarIcon: tabIcon("home", "home-outline"),
        }}
      />
      <Tabs.Screen
        name="usage"
        options={{
          title: str("usage.tab"),
          tabBarIcon: tabIcon("pie-chart", "pie-chart-outline"),
        }}
      />
      <Tabs.Screen
        name="bags"
        options={{
          title: str("bags.tab"),
          tabBarIcon: tabIcon("bag-handle", "bag-handle-outline"),
        }}
      />
      <Tabs.Screen
        name="invite"
        options={{
          title: str("invite.tab"),
          tabBarIcon: tabIcon("add-circle", "add-circle-outline"),
        }}
      />
    </Tabs>
  );
}
