import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { View } from "react-native";
import { useStr } from "@/state/AppState";
import { Card } from "@/ui/Card";
import { colors, spacing } from "@/ui/theme";
import { AppText } from "@/ui/Text";

const ROWS = [
  { icon: "lock-closed-outline", key: "trust.encrypted" },
  { icon: "time-outline", key: "trust.timeboxed" },
  { icon: "list-outline", key: "trust.audited" },
] as const;

/** The entry-code trust card: encrypted / time-boxed / audited. */
export function TrustCard() {
  const str = useStr();
  return (
    <Card style={{ gap: spacing.md }}>
      <AppText weight="bold" size={17}>
        {str("trust.title")}
      </AppText>
      {ROWS.map((row) => (
        <View
          key={row.key}
          style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}
        >
          <Ionicons name={row.icon} size={22} color={colors.success} />
          <AppText size={14} color={colors.ink} style={{ flex: 1, lineHeight: 21 }}>
            {str(row.key)}
          </AppText>
        </View>
      ))}
    </Card>
  );
}
