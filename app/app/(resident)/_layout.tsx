import { Stack } from "expo-router";
import React from "react";
import { colors } from "@/ui/theme";

/** Resident shell: tabs + the submit sheet presented modally above them. */
export default function ResidentLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="submit" options={{ presentation: "modal" }} />
    </Stack>
  );
}
