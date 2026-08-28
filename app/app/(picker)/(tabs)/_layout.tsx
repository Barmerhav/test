import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { useStr } from "@/state/AppState";
import { fonts, pickerColors as pc } from "@/ui/theme";
import { MonoText } from "@/ui/Text";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function tabIcon(focused: IconName, unfocused: IconName) {
  return function TabIcon({ color, focused: isFocused }: { color: string; focused: boolean }) {
    return <Ionicons name={isFocused ? focused : unfocused} size={22} color={color} />;
  };
}

/** Picker tabs per the design: בקשות / רווחים / פרופיל (₪ glyph for earnings). */
export default function PickerTabs() {
  const str = useStr();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: pc.bg },
        tabBarActiveTintColor: pc.text,
        tabBarInactiveTintColor: pc.faint,
        tabBarStyle: {
          backgroundColor: pc.deep,
          borderTopColor: pc.tabBorder,
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
          title: str("feed.tab"),
          tabBarIcon: tabIcon("list", "list-outline"),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: str("earnings.tab"),
          tabBarIcon: ({ color }: { color: string }) => (
            <MonoText weight="heavy" size={17} color={color}>
              ₪
            </MonoText>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: str("profile.tab"),
          tabBarIcon: tabIcon("person", "person-outline"),
        }}
      />
    </Tabs>
  );
}
