/**
 * Night-graphite UI kit for PICKER (שליחים) mode — Lemata theme 6a dark.
 * ≥56px targets, glowing light-green CTAs, JetBrains Mono for every number.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressy, type HapticKind } from "./Pressy";
import { AppText } from "./Text";
import {
  darkGreenShadow,
  fonts,
  PICKER_TAP,
  pickerColors as pc,
  radii,
  spacing,
} from "./theme";

// ── screen ─────────────────────────────────────────────────────────────────

export interface PScreenProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: React.ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  headerEnd?: React.ReactNode;
}

export function PScreen({
  children,
  title,
  subtitle,
  scroll = true,
  contentStyle,
  headerEnd,
}: PScreenProps) {
  const insets = useSafeAreaInsets();
  const header =
    title !== undefined || headerEnd !== undefined ? (
      <View style={{ marginBottom: spacing.md }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing.md,
          }}
        >
          <AppText weight="black" size={24} color={pc.text} style={{ flexShrink: 1 }}>
            {title ?? ""}
          </AppText>
          {headerEnd}
        </View>
        {subtitle !== undefined ? <View style={{ marginTop: 3 }}>{subtitle}</View> : null}
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
            paddingStart: 18,
            paddingEnd: 18,
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
          paddingStart: 18,
          paddingEnd: 18,
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
  padded?: boolean;
  /** dashed border (waiting / leak affordances) */
  dashed?: boolean;
}

export function PCard({ padded = true, dashed, style, ...rest }: PCardProps) {
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: pc.surface,
          borderRadius: radii.card,
          borderWidth: dashed ? 1.5 : 1,
          borderColor: dashed ? pc.lineStrong : pc.line,
          borderStyle: dashed ? "dashed" : "solid",
          ...(padded ? { padding: 16 } : null),
        },
        style,
      ]}
    />
  );
}

// ── buttons ────────────────────────────────────────────────────────────────

type PKind = "green" | "ghost" | "danger";

export interface PButtonProps {
  label: string;
  onPress: () => void;
  kind?: PKind;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  haptic?: HapticKind;
  end?: React.ReactNode;
}

/** Dark CTA: light-green fill, deep-green text, soft glow (58px, radius 16). */
export function PButton({
  label,
  onPress,
  kind = "green",
  disabled,
  loading,
  style,
  compact,
  haptic = "light",
  end,
}: PButtonProps) {
  const inactive = disabled || loading;
  const fg = kind === "green" ? pc.onGreen : kind === "danger" ? pc.ink : pc.muted;
  return (
    <Pressy
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      haptic={inactive ? "none" : haptic}
      style={[
        {
          minHeight: compact ? 50 : PICKER_TAP + 2,
          borderRadius: compact ? 14 : 16,
          backgroundColor: inactive
            ? pc.chip
            : kind === "green"
              ? pc.green
              : kind === "danger"
                ? pc.danger
                : "transparent",
          borderWidth: kind === "ghost" ? 1.5 : 0,
          borderColor: pc.lineStrong,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.xs,
          paddingHorizontal: spacing.lg,
          ...(kind === "green" && !inactive ? darkGreenShadow : null),
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          <AppText weight="heavy" size={compact ? 14.5 : 17} color={inactive ? pc.faint : fg} center>
            {label}
          </AppText>
          {end}
        </>
      )}
    </Pressy>
  );
}

export function PConfirmButton({
  label,
  onPress,
  kind = "danger",
  disabled,
  loading,
  style,
  compact = true,
  haptic = "medium",
}: PButtonProps) {
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
      compact={compact}
      haptic={haptic}
    />
  );
}

// ── chip ───────────────────────────────────────────────────────────────────

export interface PChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  badge?: string;
}

export function PChip({ label, selected, onPress, style, badge }: PChipProps) {
  return (
    <Pressy
      accessibilityRole="button"
      onPress={onPress}
      haptic="light"
      style={[
        {
          minHeight: PICKER_TAP,
          borderRadius: radii.chip,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
          backgroundColor: selected ? pc.green : pc.surface,
          borderWidth: 1.5,
          borderColor: selected ? pc.green : pc.line,
        },
        style,
      ]}
    >
      <AppText weight="bold" size={14} color={selected ? pc.onGreen : pc.text} center>
        {label}
      </AppText>
      {badge !== undefined ? (
        <AppText weight="bold" size={10.5} color={selected ? pc.onGreen : pc.money} center>
          {badge}
        </AppText>
      ) : null}
    </Pressy>
  );
}

// ── segmented control (רשימה / מפה) ─────────────────────────────────────────

export interface PSegmentedProps {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  style?: StyleProp<ViewStyle>;
}

export function PSegmented({ options, value, onChange, style }: PSegmentedProps) {
  return (
    <View
      style={[
        {
          flexDirection: "row",
          backgroundColor: pc.surface,
          borderWidth: 1,
          borderColor: pc.line,
          borderRadius: radii.chip,
          padding: 3,
        },
        style,
      ]}
    >
      {options.map((opt) => {
        const selected = opt.key === value;
        return (
          <Pressy
            key={opt.key}
            accessibilityRole="button"
            onPress={() => onChange(opt.key)}
            haptic="light"
            style={{
              flex: 1,
              minHeight: 38,
              borderRadius: 9,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: selected ? pc.text : "transparent",
            }}
          >
            <AppText weight="bold" size={13} color={selected ? pc.bg : pc.muted} center>
              {opt.label}
            </AppText>
          </Pressy>
        );
      })}
    </View>
  );
}

// ── availability pill (glowing dot) ─────────────────────────────────────────

export function PAvailabilityPill({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <Pressy
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      onPress={() => onToggle(!on)}
      haptic="light"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderWidth: 1.5,
        borderColor: on ? pc.green : pc.lineStrong,
        backgroundColor: on ? pc.glowSoft : "transparent",
        borderRadius: radii.pill,
        paddingVertical: 9,
        paddingHorizontal: 15,
        minHeight: TAP_MIN,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 99,
          backgroundColor: on ? pc.green : pc.faint,
          shadowColor: pc.green,
          shadowOpacity: on ? 0.8 : 0,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
      <AppText weight="heavy" size={13.5} color={on ? pc.money : pc.muted}>
        {label}
      </AppText>
    </Pressy>
  );
}

const TAP_MIN = 48;

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
      <AppText weight="semibold" size={13} color={pc.muted}>
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={pc.faint}
        maxLength={maxLength}
        style={{
          minHeight: PICKER_TAP,
          borderRadius: radii.chip,
          borderWidth: 1.5,
          borderColor: pc.line,
          backgroundColor: pc.surface,
          paddingHorizontal: spacing.md,
          fontFamily: mono ? fonts.monoBold : fonts.medium,
          fontSize: 16,
          color: pc.text,
          ...(mono
            ? { writingDirection: "ltr" as const, textAlign: "center" as const }
            : null),
        }}
      />
    </View>
  );
}
