/** Scale-down press feedback wrapper — the SaaS-grade touch feel used by
 * every pressable in the app. Optionally fires a haptic on press. */
import * as Haptics from "expo-haptics";
import React, { useRef } from "react";
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export type HapticKind = "light" | "medium" | "success" | "none";

export async function fireHaptic(kind: HapticKind): Promise<void> {
  try {
    if (kind === "light") await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else if (kind === "medium") await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else if (kind === "success")
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // no haptics on this device — fine
  }
}

export interface PressyProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  haptic?: HapticKind;
  children?: React.ReactNode;
}

export function Pressy({ style, haptic = "none", onPress, children, ...rest }: PressyProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (v: number) => {
    Animated.spring(scale, {
      toValue: v,
      useNativeDriver: true,
      speed: 40,
      bounciness: 4,
    }).start();
  };

  return (
    <Pressable
      {...rest}
      onPressIn={() => animateTo(0.97)}
      onPressOut={() => animateTo(1)}
      onPress={(e) => {
        if (haptic !== "none") void fireHaptic(haptic);
        onPress?.(e);
      }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
