import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { View } from "react-native";
import { useStr } from "@/state/AppState";
import { Button } from "./Button";
import { PButton } from "./PickerUI";
import { SkeletonList } from "./Skeleton";
import { colors, pickerColors as pc, spacing } from "./theme";
import { AppText } from "./Text";

export interface QueryStateProps {
  /** first-paint loading (no data yet) */
  loading: boolean;
  /** the query failed and there is nothing to show */
  error: boolean;
  onRetry: () => void;
  dark?: boolean;
  rows?: number;
  rowHeight?: number;
  /** rendered when neither loading nor error (list empty state) */
  empty?: React.ReactNode;
}

/**
 * One shared resolver for list screens: skeleton while loading, an explicit
 * error state with retry when the query failed — NEVER eternal shimmer and
 * never a misleading empty state on network failure.
 */
export function QueryState({
  loading,
  error,
  onRetry,
  dark,
  rows = 3,
  rowHeight = 84,
  empty,
}: QueryStateProps) {
  const str = useStr();

  if (loading && !error) {
    return <SkeletonList rows={rows} height={rowHeight} dark={dark} />;
  }

  if (error) {
    return (
      <View style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.md }}>
        <Ionicons
          name="cloud-offline-outline"
          size={40}
          color={dark ? pc.faint : colors.faint}
        />
        <AppText size={14} color={dark ? pc.muted : colors.text2} center>
          {str("error.unknown")}
        </AppText>
        {dark ? (
          <PButton label={str("common.retry")} kind="ghost" onPress={onRetry} compact />
        ) : (
          <Button label={str("common.retry")} kind="ghost" onPress={onRetry} compact />
        )}
      </View>
    );
  }

  return <>{empty ?? null}</>;
}
