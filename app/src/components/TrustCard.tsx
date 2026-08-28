import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { View } from "react-native";
import { useConfig, useStr } from "@/state/AppState";
import { Card } from "@/ui/Card";
import { colors, spacing } from "@/ui/theme";
import { AppText } from "@/ui/Text";

/** The trust moment (artboard 01c): green-check rows — encrypted,
 * time-boxed reveal ({minutes} from config), audited. */
export function TrustCard() {
  const str = useStr();
  const revealMinutes = useConfig("code_reveal_window_minutes");

  const rows: string[] = [
    str("trust.encrypted"),
    str("trust.timeboxed", { minutes: revealMinutes }),
    str("trust.audited"),
  ];

  return (
    <Card mint style={{ gap: spacing.md }}>
      <AppText weight="heavy" size={16} color={colors.inkDeep}>
        {str("trust.title")}
      </AppText>
      {rows.map((text) => (
        <View
          key={text}
          style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 99,
              backgroundColor: colors.greenDeep,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 1,
            }}
          >
            <Ionicons name="checkmark" size={13} color={colors.card} />
          </View>
          <AppText size={13.5} color={colors.inkDeep} style={{ flex: 1, lineHeight: 20 }}>
            {text}
          </AppText>
        </View>
      ))}
    </Card>
  );
}
