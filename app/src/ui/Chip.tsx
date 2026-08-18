import React from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import { colors, radii, TAP, spacing } from "./theme";
import { AppText } from "./Text";

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export function Chip({ label, selected, onPress, style }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: TAP,
          borderRadius: radii.chip,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: selected ? colors.ink : colors.card,
          borderWidth: 1,
          borderColor: selected ? colors.ink : colors.line,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <AppText weight={selected ? "bold" : "medium"} size={15} color={selected ? colors.card : colors.ink}>
        {label}
      </AppText>
    </Pressable>
  );
}
