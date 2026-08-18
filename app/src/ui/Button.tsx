import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, radii, TAP, spacing } from "./theme";
import { AppText } from "./Text";

type Kind = "primary" | "ghost" | "danger" | "success";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  kind?: Kind;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

const bgFor: Record<Kind, string> = {
  primary: colors.accent,
  ghost: "transparent",
  danger: colors.danger,
  success: colors.success,
};

const fgFor: Record<Kind, string> = {
  primary: colors.ink,
  ghost: colors.ink,
  danger: colors.card,
  success: colors.card,
};

export function Button({
  label,
  onPress,
  kind = "primary",
  disabled,
  loading,
  style,
  compact,
}: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        {
          minHeight: compact ? TAP : 56,
          borderRadius: radii.button,
          backgroundColor: inactive && kind !== "ghost" ? colors.line : bgFor[kind],
          borderWidth: kind === "ghost" ? 1 : 0,
          borderColor: colors.line,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fgFor[kind]} />
      ) : (
        <AppText
          weight="bold"
          size={compact ? 15 : 17}
          color={inactive ? colors.muted : fgFor[kind]}
          center
        >
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

/**
 * Two-tap confirm button: first press arms it (visual shift), second press
 * within a few seconds executes. Avoids needing OK/Cancel dialog strings.
 */
export function ConfirmButton({
  label,
  onPress,
  kind = "danger",
  disabled,
  loading,
  style,
  compact = true,
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
    />
  );
}
