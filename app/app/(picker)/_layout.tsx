import { Stack } from "expo-router";
import React from "react";
import { pickerColors } from "@/ui/theme";

/** Picker shell (night graphite): onboarding/pending/blocked + tabs + the
 * stop → collect → finish money loop. */
export default function PickerLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: pickerColors.bg },
      }}
    >
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="pending" />
      <Stack.Screen name="blocked" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="stop" />
      <Stack.Screen name="collect/[claimId]" />
      <Stack.Screen name="finish" options={{ presentation: "modal", gestureEnabled: true }} />
    </Stack>
  );
}
