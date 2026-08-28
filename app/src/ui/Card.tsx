import React from "react";
import { View, type ViewProps, type ViewStyle } from "react-native";
import { colors, radii, shadow, spacing } from "./theme";

export interface CardProps extends ViewProps {
  padded?: boolean;
  /** green-tinted emphasis border */
  accent?: boolean;
  /** mint success-surface card (referral / credit banners) */
  mint?: boolean;
  big?: boolean;
}

/** Lemata card: radius 18–22, 1px border, white on the warm-paper bg. */
export function Card({ padded = true, accent, mint, big, style, ...rest }: CardProps) {
  const base: ViewStyle = {
    backgroundColor: mint ? colors.mintCard : colors.card,
    borderRadius: big ? radii.cardBig : radii.card,
    borderWidth: 1,
    borderColor: mint ? colors.mintCardBorder : accent ? colors.green : colors.lineSoft,
    ...(padded ? { padding: 20 } : null),
    ...shadow,
  };
  return <View {...rest} style={[base, style]} />;
}

/** Thin divider row used in settings lists. */
export function Divider() {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: colors.lineAlt,
        marginVertical: spacing.xs,
      }}
    />
  );
}
