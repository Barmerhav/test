import React from "react";
import { TextInput, View, type KeyboardTypeOptions, type StyleProp, type ViewStyle } from "react-native";
import { colors, fonts, radii, TAP, spacing } from "./theme";
import { AppText } from "./Text";

export interface FieldProps {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: KeyboardTypeOptions;
  mono?: boolean;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  maxLength?: number;
  autoFocus?: boolean;
}

export function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  mono,
  placeholder,
  style,
  maxLength,
  autoFocus,
}: FieldProps) {
  return (
    <View style={[{ gap: spacing.xs }, style]}>
      <AppText weight="medium" size={14} color={colors.muted}>
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        maxLength={maxLength}
        autoFocus={autoFocus}
        style={{
          minHeight: TAP + 4,
          borderRadius: radii.chip,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.card,
          paddingHorizontal: spacing.md,
          fontFamily: mono ? fonts.mono : fonts.regular,
          fontSize: 17,
          color: colors.ink,
          ...(mono ? { writingDirection: "ltr" as const, textAlign: "center" as const } : null),
        }}
      />
    </View>
  );
}
