import React from "react";
import { View, type ViewProps, type ViewStyle } from "react-native";
import { colors, radii, shadow, spacing } from "./theme";

export interface CardProps extends ViewProps {
  padded?: boolean;
  accent?: boolean;
}

export function Card({ padded = true, accent, style, ...rest }: CardProps) {
  const base: ViewStyle = {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: accent ? colors.accent : colors.line,
    ...(padded ? { padding: spacing.md } : null),
    ...shadow,
  };
  return <View {...rest} style={[base, style]} />;
}
