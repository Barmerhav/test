import React, { useEffect, useRef } from "react";
import { Animated, View, type DimensionValue } from "react-native";
import { colors, pickerColors, radii, spacing } from "./theme";

export interface SkeletonProps {
  height?: number;
  width?: DimensionValue;
  radius?: number;
  dark?: boolean;
}

/** Shimmering placeholder block — never a bare spinner on first paint. */
export function Skeleton({ height = 72, width = "100%", radius = radii.card, dark }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{
        height,
        width,
        borderRadius: radius,
        backgroundColor: dark ? pickerColors.surface : colors.surface,
        opacity,
      }}
    />
  );
}

/** A column of skeleton cards for list first-paint. */
export function SkeletonList({ rows = 3, height = 84, dark }: { rows?: number; height?: number; dark?: boolean }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={height} dark={dark} />
      ))}
    </View>
  );
}
