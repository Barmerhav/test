import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import { Pressy } from "./Pressy";
import { AppText } from "./Text";
import { colors, radii, spacing, TAP } from "./theme";

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  /** selected style: green fill with a check (design: TTL chips) */
  check?: boolean;
}

export function Chip({ label, selected, onPress, style, check }: ChipProps) {
  const selBg = check ? colors.green : colors.ink;
  const selFg = check ? colors.onGreen : colors.card;
  return (
    <Pressy
      accessibilityRole="button"
      onPress={onPress}
      haptic="light"
      style={[
        {
          minHeight: TAP,
          borderRadius: radii.pill,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          backgroundColor: selected ? selBg : colors.card,
          borderWidth: 1.5,
          borderColor: selected ? selBg : colors.line,
        },
        style,
      ]}
    >
      <AppText
        weight="bold"
        size={13.5}
        color={selected ? selFg : colors.text2}
        center
      >
        {label}
      </AppText>
      {check && selected ? (
        <Ionicons name="checkmark" size={15} color={selFg} />
      ) : null}
    </Pressy>
  );
}
