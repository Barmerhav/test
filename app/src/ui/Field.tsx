import React from "react";
import {
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, fonts, radii, TAP, spacing } from "./theme";
import { AppText } from "./Text";

export interface FieldProps {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: KeyboardTypeOptions;
  mono?: boolean;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  maxLength?: number;
  autoFocus?: boolean;
  /** static LTR prefix chip rendered beside the input (e.g. +972) */
  prefix?: string;
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
  prefix,
}: FieldProps) {
  return (
    <View style={[{ gap: spacing.xs }, style]}>
      {label !== undefined ? (
        <AppText weight="semibold" size={13} color={colors.muted}>
          {label}
        </AppText>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderRadius: radii.field,
          borderWidth: 1.5,
          borderColor: colors.line,
          backgroundColor: colors.card,
          overflow: "hidden",
        }}
      >
        {prefix !== undefined ? (
          <View
            style={{
              paddingHorizontal: spacing.md,
              alignSelf: "stretch",
              justifyContent: "center",
              backgroundColor: colors.surface,
              borderEndWidth: 1,
              borderEndColor: colors.line,
            }}
          >
            <AppText
              size={15}
              color={colors.text2}
              style={{ fontFamily: fonts.monoBold, writingDirection: "ltr" }}
            >
              {prefix}
            </AppText>
          </View>
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          maxLength={maxLength}
          autoFocus={autoFocus}
          style={{
            flex: 1,
            minHeight: TAP + 4,
            paddingHorizontal: spacing.md,
            fontFamily: mono ? fonts.monoBold : fonts.medium,
            fontSize: 16,
            color: colors.ink,
            ...(mono
              ? { writingDirection: "ltr" as const, textAlign: "center" as const }
              : null),
          }}
        />
      </View>
    </View>
  );
}
