import React from "react";
import { ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "./theme";
import { AppText } from "./Text";

export interface ScreenProps {
  children: React.ReactNode;
  title?: string;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** extra bottom inset (e.g. above tab bar) */
  padBottom?: number;
}

export function Screen({ children, title, scroll = true, contentStyle, padBottom = 0 }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const inner = (
    <>
      {title !== undefined ? (
        <AppText weight="bold" size={26} style={{ marginBottom: spacing.lg }}>
          {title}
        </AppText>
      ) : null}
      {children}
    </>
  );
  if (!scroll) {
    return (
      <View
        style={[
          {
            flex: 1,
            backgroundColor: colors.bg,
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.md + padBottom,
            paddingStart: spacing.lg,
            paddingEnd: spacing.lg,
          },
          contentStyle,
        ]}
      >
        {inner}
      </View>
    );
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[
        {
          paddingTop: insets.top + spacing.md,
          paddingBottom: insets.bottom + spacing.xl + padBottom,
          paddingStart: spacing.lg,
          paddingEnd: spacing.lg,
        },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {inner}
    </ScrollView>
  );
}
