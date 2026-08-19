import React from "react";
import { RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "./theme";
import { AppText } from "./Text";

export interface ScreenProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  headerEnd?: React.ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  padBottom?: number;
  refreshing?: boolean;
  onRefresh?: () => void;
}

export function Screen({
  children,
  title,
  subtitle,
  headerEnd,
  scroll = true,
  contentStyle,
  padBottom = 0,
  refreshing,
  onRefresh,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const header =
    title !== undefined || headerEnd !== undefined ? (
      <View style={{ marginBottom: spacing.lg }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing.md,
          }}
        >
          <AppText weight="black" size={24} style={{ flexShrink: 1 }}>
            {title ?? ""}
          </AppText>
          {headerEnd}
        </View>
        {subtitle !== undefined ? (
          <AppText size={13} color={colors.text2} style={{ marginTop: 3 }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
    ) : null;

  const inner = (
    <>
      {header}
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
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing ?? false}
            onRefresh={onRefresh}
            tintColor={colors.green}
          />
        ) : undefined
      }
    >
      {inner}
    </ScrollView>
  );
}
