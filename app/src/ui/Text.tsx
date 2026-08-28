import React from "react";
import { Text, type TextProps, type TextStyle } from "react-native";
import { colors, fonts } from "./theme";

type Weight = "regular" | "medium" | "semibold" | "bold" | "heavy" | "black";

export interface AppTextProps extends TextProps {
  weight?: Weight;
  size?: number;
  color?: string;
  center?: boolean;
}

const weightToFont: Record<Weight, string> = {
  regular: fonts.regular,
  medium: fonts.medium,
  semibold: fonts.semibold,
  bold: fonts.bold,
  heavy: fonts.heavy,
  black: fonts.black,
};

/** Hebrew-first body text (Heebo, weights 400–900). */
export function AppText({
  weight = "medium",
  size = 15,
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

type MonoWeight = "medium" | "bold" | "heavy";

export interface MonoTextProps extends TextProps {
  weight?: MonoWeight;
  /** legacy alias for weight="bold" */
  bold?: boolean;
  size?: number;
  color?: string;
  center?: boolean;
}

const monoToFont: Record<MonoWeight, string> = {
  medium: fonts.mono,
  bold: fonts.monoBold,
  heavy: fonts.monoHeavy,
};

/** EVERY number (money, counts, timers, codes, phone) renders in JetBrains
 * Mono, forced LTR so digits never flip inside Hebrew sentences. */
export function MonoText({
  weight,
  bold,
  size = 15,
  color = colors.ink,
  center,
  style,
  ...rest
}: MonoTextProps) {
  const w: MonoWeight = weight ?? (bold ? "bold" : "medium");
  const base: TextStyle = {
    fontFamily: monoToFont[w],
    fontSize: size,
    color,
    writingDirection: "ltr",
    ...(center ? { textAlign: "center" as const } : null),
  };
  return <Text {...rest} style={[base, style]} />;
}
