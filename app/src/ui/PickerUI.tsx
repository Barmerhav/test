/**
 * Dark-theme UI kit for PICKER mode. Mirrors the resident kit but with the
 * gig palette and ≥56px tap targets. Visual constants only — all copy comes
 * from the strings table via useStr().
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "./Text";
import { fonts, PICKER_TAP, pickerColors as pc, radii, spacing } from "./theme";

// ── screen ─────────────────────────────────────────────────────────────────

export interface PScreenProps {
  children: React.ReactNode;
  title?: string;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  headerEnd?: React.ReactNode;
}

export function PScreen({ children, title, scroll = true, contentStyle, headerEnd }: PScreenProps) {
  const insets = useSafeAreaInsets();
  const header =
    title !== undefined || headerEnd !== undefined ? (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: spacing.lg,
          gap: spacing.md,
        }}
      >
        <AppText weight="bold" size={24} color={pc.text} style={{ flexShrink: 1 }}>
          {title ?? ""}
        </AppText>
        {headerEnd}
      </View>
    ) : null;

  if (!scroll) {
    return (
      <View
        style={[
          {
            flex: 1,
            backgroundColor: pc.bg,
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.md,
            paddingStart: spacing.lg,
            paddingEnd: spacing.lg,
          },
          contentStyle,
        ]}
      >
        {header}
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: pc.bg }}
      contentContainerStyle={[
        {
          paddingTop: insets.top + spacing.md,
          paddingBottom: insets.bottom + spacing.xl,
          paddingStart: spacing.lg,
          paddingEnd: spacing.lg,
        },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {header}
      {children}
    </ScrollView>
  );
}

// ── card ───────────────────────────────────────────────────────────────────

export interface PCardProps extends ViewProps {
  /** light emphasis card (ink text on paper) */
  paper?: boolean;
  padded?: boolean;
}

export function PCard({ paper, padded = true, style, ...rest }: PCardProps) {
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: paper ? pc.paper : pc.surface,
          borderRadius: radii.card,
          borderWidth: 1,
          borderColor: paper ? pc.paper : pc.line,
          ...(padded ? { padding: spacing.md } : null),
        },
        style,
      ]}
    />
  );
}

// ── buttons ────────────────────────────────────────────────────────────────

type PKind = "amber" | "ghost" | "danger" | "success";

export interface PButtonProps {
  label: string;
  onPress: () => void;
  kind?: PKind;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

const pBg: Record<PKind, string> = {
  amber: pc.amber,
  ghost: "transparent",
  danger: pc.danger,
  success: pc.success,
};

const pFg: Record<PKind, string> = {
  amber: pc.ink,
  ghost: pc.text,
  danger: pc.ink,
  success: pc.ink,
};

export function PButton({ label, onPress, kind = "amber", disabled, loading, style }: PButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        {
          minHeight: PICKER_TAP,
          borderRadius: radii.button,
          backgroundColor: inactive && kind !== "ghost" ? pc.line : pBg[kind],
          borderWidth: kind === "ghost" ? 1 : 0,
          borderColor: pc.line,
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
        <ActivityIndicator color={pFg[kind]} />
      ) : (
        <AppText weight="bold" size={17} color={inactive ? pc.muted : pFg[kind]} center>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

/** Two-tap confirm (dark variant) — same pattern as the resident kit. */
export function PConfirmButton({ label, onPress, kind = "danger", disabled, loading, style }: PButtonProps) {
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
    <PButton
      label={label}
      onPress={handlePress}
      kind={armed ? kind : "ghost"}
      disabled={disabled}
      loading={loading}
      style={style}
    />
  );
}

// ── chip ───────────────────────────────────────────────────────────────────

export interface PChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export function PChip({ label, selected, onPress, style }: PChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: PICKER_TAP,
          borderRadius: radii.chip,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: selected ? pc.amber : pc.surface,
          borderWidth: 1,
          borderColor: selected ? pc.amber : pc.line,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <AppText weight={selected ? "bold" : "medium"} size={15} color={selected ? pc.ink : pc.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

// ── field ──────────────────────────────────────────────────────────────────

export interface PFieldProps {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: KeyboardTypeOptions;
  mono?: boolean;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  maxLength?: number;
}

export function PField({
  label,
  value,
  onChangeText,
  keyboardType,
  mono,
  placeholder,
  style,
  maxLength,
}: PFieldProps) {
  return (
    <View style={[{ gap: spacing.xs }, style]}>
      <AppText weight="medium" size={14} color={pc.muted}>
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={pc.muted}
        maxLength={maxLength}
        style={{
          minHeight: PICKER_TAP,
          borderRadius: radii.chip,
          borderWidth: 1,
          borderColor: pc.line,
          backgroundColor: pc.surface,
          paddingHorizontal: spacing.md,
          fontFamily: mono ? fonts.mono : fonts.regular,
          fontSize: 17,
          color: pc.text,
          ...(mono ? { writingDirection: "ltr" as const, textAlign: "center" as const } : null),
        }}
      />
    </View>
  );
}
