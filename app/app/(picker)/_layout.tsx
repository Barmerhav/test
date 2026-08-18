import { Stack } from "expo-router";
import React from "react";
import { pickerColors } from "@/ui/theme";

/** Picker shell (dark): onboarding/pending/blocked + tabs + collect/finish. */
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
      <Stack.Screen name="collect/[claimId]" />
      <Stack.Screen name="finish" options={{ presentation: "modal" }} />
    </Stack>
  );
}
