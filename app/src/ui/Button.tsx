import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, type StyleProp, type ViewStyle } from "react-native";
import { Pressy, type HapticKind } from "./Pressy";
import { AppText } from "./Text";
import { colors, greenShadow, radii, spacing, TAP } from "./theme";

type Kind = "primary" | "ghost" | "danger" | "success" | "dark";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  kind?: Kind;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  /** taller hero CTA (62px, radius 18) per the submit-sheet artboard */
  big?: boolean;
  caption?: string;
  haptic?: HapticKind;
}

const bgFor: Record<Kind, string> = {
  primary: colors.green,
  ghost: "transparent",
  danger: colors.danger,
  success: colors.greenDeep,
  dark: colors.ink,
};

const fgFor: Record<Kind, string> = {
  primary: colors.onGreen,
  ghost: colors.text2,
  danger: colors.card,
  success: colors.onGreen,
  dark: colors.bg,
};

/** Lemata primary button: 52px, radius 14, green with soft green shadow. */
export function Button({
  label,
  onPress,
  kind = "primary",
  disabled,
  loading,
  style,
  compact,
  big,
  caption,
  haptic = "light",
}: ButtonProps) {
  const inactive = disabled || loading;
  const height = big ? 62 : compact ? TAP : 52;
  return (
    <Pressy
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      haptic={inactive ? "none" : haptic}
      style={[
        {
          minHeight: height,
          borderRadius: big ? radii.buttonBig : radii.button,
          backgroundColor: inactive && kind !== "ghost" ? colors.line : bgFor[kind],
          borderWidth: kind === "ghost" ? 1.5 : 0,
          borderColor: colors.line,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.xs,
          ...(kind === "primary" && !inactive ? greenShadow : null),
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={kind === "ghost" ? colors.green : fgFor[kind]} />
      ) : (
        <>
          <AppText
            weight="heavy"
            size={big ? 18 : compact ? 14 : 16}
            color={inactive ? colors.muted : fgFor[kind]}
            center
          >
            {label}
          </AppText>
          {caption ? (
            <AppText size={12} color={inactive ? colors.faint : colors.onGreenDim} center>
              {caption}
            </AppText>
          ) : null}
        </>
      )}
    </Pressy>
  );
}

/**
 * Two-tap confirm button: first press arms it (visual shift), second press
 * within a few seconds executes. Avoids OK/Cancel dialog strings entirely.
 */
export function ConfirmButton({
  label,
  onPress,
  kind = "danger",
  disabled,
  loading,
  style,
  compact = true,
  haptic = "medium",
}: ButtonProps) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handlePress = () => {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    onPress();
  };

  return (
    <Button
      label={label}
      onPress={handlePress}
      kind={armed ? kind : "ghost"}
      disabled={disabled}
      loading={loading}
      style={style}
      compact={compact}
      haptic={haptic}
    />
  );
}
