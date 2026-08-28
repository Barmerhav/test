import { Stack } from "expo-router";
import React from "react";
import { colors } from "@/ui/theme";

/** Resident shell: tabs + the submit sheet (modal) + settings (pushed). */
export default function ResidentLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="submit"
        options={{ presentation: "modal", gestureEnabled: true }}
      />
      <Stack.Screen name="settings" />
    </Stack>
  );
}
