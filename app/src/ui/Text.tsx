import React from "react";
import { Text, type TextProps, type TextStyle } from "react-native";
import { colors, fonts } from "./theme";

type Weight = "regular" | "medium" | "bold";

export interface AppTextProps extends TextProps {
  weight?: Weight;
  size?: number;
  color?: string;
  center?: boolean;
}

const weightToFont: Record<Weight, string> = {
  regular: fonts.regular,
  medium: fonts.medium,
  bold: fonts.bold,
};

/** Hebrew-first body text (Heebo). */
export function AppText({
  weight = "regular",
  size = 16,
  color = colors.ink,
  center,
  style,
  ...rest
}: AppTextProps) {
  const base: TextStyle = {
    fontFamily: weightToFont[weight],
    fontSize: size,
    color,
    ...(center ? { textAlign: "center" as const } : null),
  };
  return <Text {...rest} style={[base, style]} />;
}

export interface MonoTextProps extends TextProps {
  bold?: boolean;
  size?: number;
  color?: string;
  center?: boolean;
}

/** EVERY number (money, counts, countdowns) renders in JetBrains Mono and is
 * forced LTR so digits never flip inside Hebrew sentences. */
export function MonoText({
  bold,
  size = 16,
  color = colors.ink,
  center,
  style,
  ...rest
}: MonoTextProps) {
  const base: TextStyle = {
    fontFamily: bold ? fonts.monoBold : fonts.mono,
    fontSize: size,
    color,
    writingDirection: "ltr",
    ...(center ? { textAlign: "center" as const } : null),
  };
  return <Text {...rest} style={[base, style]} />;
}
